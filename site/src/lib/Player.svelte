<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Mixer } from './audio.svelte.ts';
	import {
		BAR_SECONDS,
		NOW_X,
		drawBars,
		drawSheet,
		drawTimeline,
		type MicTrace
	} from './canvas.ts';
	import { assignColors } from './colors.ts';
	import Lyrics from './Lyrics.svelte';
	import { Mic } from './mic.svelte.ts';
	import { mediaUrl } from './pieces.ts';
	import { Sheet } from './sheet.ts';
	import type { PieceData, PieceEntry, View } from './types.ts';

	// The route re-creates this component for each piece, so props never change after creation.
	let {
		season,
		entry,
		piece,
		pieces
	}: { season: string; entry: PieceEntry; piece: PieceData; pieces: PieceEntry[] } = $props();
	// svelte-ignore state_referenced_locally
	const { voices, parts, measures, audio, engravings } = piece;
	// svelte-ignore state_referenced_locally
	const fileUrl = (file: string) => mediaUrl(season, `${entry.slug}/${file}`);

	const SPATIUM_PX = 7; // size of the sheet music: the distance between staff lines
	const VIEWS: { id: View; label: string }[] = [
		{ id: 'pitch', label: 'Pitch' },
		{ id: 'lyrics', label: 'Lyrics' }
	];
	const voiceNames = voices.map((v) => v.name);
	const colors = assignColors(voices);
	const accompaniment = parts.filter((p) => !p.vocal).map((p) => p.name);
	const mixer = new Mixer(
		parts.map((p) => p.name),
		audio
	);

	// Background hue changes at the first syllable starting with each configured word.
	// svelte-ignore state_referenced_locally
	const hueTimes = (entry.hues ?? []).map(([word, hue]) => [
		voices[0].syllables.find((s) => s.text.startsWith(word))?.t0 ?? Infinity,
		hue
	]);

	let selected = $state([voiceNames[0]]);
	let view: View = $state('pitch');
	let emphasis = $state(0.7);
	let accompLevels = $state(Object.fromEntries(accompaniment.map((n) => [n, 0.6])));
	let t = $state(0);
	let barsCanvas: HTMLCanvasElement | undefined = $state();
	let timelineCanvas: HTMLCanvasElement;
	const partButtons: Record<string, HTMLButtonElement> = {};
	const mic = new Mic();
	const micTrace: MicTrace = { trail: [], now: null };

	const sheets = engravings.map((e) => new Sheet(e, fileUrl(e.file)));
	// A single selected part gets its own engraving; several get the one with all vocal parts.
	const sheet = $derived(
		sheets.find((s) =>
			selected.length === 1 ? s.info.parts.join() === selected[0] : s.info.parts.length > 1
		) ?? null
	);
	let sheetCanvas: HTMLCanvasElement | undefined = $state();
	let windowHeight = $state(0);
	// Staves the same size in every piece, unless the sheet would take more than a third of the window.
	const sheetHeight = $derived(
		sheet && Math.min((sheet.info.height / sheet.info.spatium) * SPATIUM_PX, windowHeight / 3)
	);
	const selectedSet = $derived(new Set(selected));
	const measure = $derived(measureAt(t));
	const hue = $derived(
		hueTimes.filter(([st]) => st <= t + 1).pop()?.[1] ?? hueTimes[0]?.[1] ?? 215
	);

	$effect(() => {
		for (const { name, vocal } of parts) {
			const unselected = 1 - 0.9 * emphasis;
			mixer.setGain(name, !vocal ? accompLevels[name] : selected.includes(name) ? 1 : unselected);
		}
	});

	onMount(() => {
		const controller = new AbortController();
		const dirs = Object.fromEntries(parts.map((p) => [p.name, fileUrl(p.file)]));
		mixer.load(dirs, controller.signal).catch(() => {});
		let raf = requestAnimationFrame(function frame() {
			t = mixer.now();
			if (mixer.playing && t >= mixer.duration) mixer.pause();
			if (mic.active) recordMic();
			if (view !== 'lyrics' && barsCanvas)
				drawBars(barsCanvas, piece, colors, t, selectedSet, mic.active ? micTrace : null);
			if (sheet && sheetCanvas) drawSheet(sheetCanvas, sheet, t, colors[selected[0]]);
			drawTimeline(timelineCanvas, piece, colors, mixer, t);
			raf = requestAnimationFrame(frame);
		});
		return () => {
			cancelAnimationFrame(raf);
			controller.abort();
			mixer.close();
			mic.stop();
		};
	});

	/** Adds the mic's current pitch to the trail, which follows the playhead. */
	function recordMic() {
		micTrace.now = mic.read();
		if (!mixer.playing || mixer.waiting) return;
		const at = t - mic.delay,
			{ trail } = micTrace;
		// After seeking back, the new attempt replaces the old one.
		while (trail.length && trail[trail.length - 1].t >= at) trail.pop();
		trail.push({ t: at, p: micTrace.now ?? NaN });
	}

	function toggleMic() {
		if (mic.active) mic.stop();
		else mic.start();
		micTrace.trail = [];
	}

	function seek(time: number) {
		mixer.seek(time);
		t = mixer.now();
	}

	function togglePlay() {
		if (mixer.playing) mixer.pause();
		else mixer.play();
	}

	/** Selects a single part, or with `extend`, adds it to or removes it from the selection. */
	function pick(name: string, extend: boolean) {
		if (!extend) selected = [name];
		else if (!selected.includes(name)) selected = voiceNames.filter((n) => n === name || selected.includes(n));
		else if (selected.length > 1) selected = selected.filter((n) => n !== name);
		partButtons[name].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
	}

	function measureAt(t: number) {
		let lo = 0,
			hi = measures.length - 2;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (measures[mid] <= t) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}

	const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

	function seekFromClick(e: MouseEvent, toTime: (fraction: number) => number) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		seek(toTime((e.clientX - rect.left) / rect.width));
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const tag = (e.target as HTMLElement).tagName;
		if (tag === 'SELECT' || (tag === 'INPUT' && e.key !== ' ')) return;
		const digit = /^Digit(\d)$/.exec(e.code)?.[1];
		if (e.key === ' ') {
			e.preventDefault();
			togglePlay();
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			const m = measureAt(t + 0.3) + (e.key === 'ArrowRight' ? 1 : -1);
			seek(measures[Math.max(0, Math.min(m, measures.length - 2))]);
		} else if (digit === '0') {
			selected = voiceNames;
		} else if (digit && voiceNames[+digit - 1]) {
			pick(voiceNames[+digit - 1], e.shiftKey);
		} else if (e.key === 'm' || e.key === 'M') {
			toggleMic();
		} else if (e.key === 'v' || e.key === 'V') {
			view = VIEWS[(VIEWS.findIndex((v) => v.id === view) + 1) % VIEWS.length].id;
		}
	}

	// Fades out the edges of a horizontally scrolling element where more content is hidden, and
	// lets a vertical mouse wheel scroll it.
	function scrollFades(el: HTMLElement) {
		const update = () => {
			el.classList.toggle('fade-start', el.scrollLeft > 1);
			el.classList.toggle('fade-end', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
		};
		const onwheel = (e: WheelEvent) => {
			if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
			e.preventDefault();
			el.scrollLeft += e.deltaY;
		};
		const observer = new ResizeObserver(update);
		observer.observe(el);
		el.addEventListener('scroll', update, { passive: true });
		el.addEventListener('wheel', onwheel);
		return () => {
			observer.disconnect();
			el.removeEventListener('scroll', update);
			el.removeEventListener('wheel', onwheel);
		};
	}

	// Anchor positioning isn't available everywhere yet, so place the mix panel above its button.
	function placeAbove(e: ToggleEvent) {
		if (e.newState !== 'open') return;
		const panel = e.currentTarget as HTMLElement;
		const button = document.querySelector(`[popovertarget="${panel.id}"]`)!;
		const rect = button.getBoundingClientRect();
		panel.style.right = `${document.documentElement.clientWidth - rect.right}px`;
		panel.style.bottom = `${innerHeight - rect.top + 8}px`;
	}
</script>

<svelte:window {onkeydown} bind:innerHeight={windowHeight} />
<svelte:head><title>{piece.title}</title></svelte:head>

<div class="player" style:--bg-hue={hue}>
	<header>
		<select
			class="piece"
			aria-label="Piece"
			value={entry.slug}
			onchange={(e) => goto(resolve('/[season]/[slug]', { season, slug: e.currentTarget.value }))}
		>
			{#each pieces as p (p.slug)}
				<option value={p.slug}>{p.label}</option>
			{/each}
		</select>
		<h1>{piece.title}</h1>
		<div class="credits">
			{[piece.subtitle, piece.credits].filter(Boolean).join(' · ')}
		</div>
	</header>

	<main class="stage">
		{#if view === 'lyrics'}
			<Lyrics {voices} {colors} selected={selectedSet} {t} onseek={seek} />
		{:else}
			<canvas
				class="bars"
				title="Click to seek"
				bind:this={barsCanvas}
				onclick={(e) => seekFromClick(e, (f) => t + (f - NOW_X) * BAR_SECONDS)}
			></canvas>
		{/if}
	</main>

	<footer>
		{#if view === 'pitch' && sheet}
			<canvas
				class="sheet"
				style:height="{sheetHeight}px"
				title="Click to seek"
				bind:this={sheetCanvas}
				onclick={(e) => seek(sheet.timeAt(e.offsetX))}
			></canvas>
		{/if}
		<canvas
			class="timeline"
			title="Click to seek"
			bind:this={timelineCanvas}
			onclick={(e) => seekFromClick(e, (f) => f * mixer.duration)}
		></canvas>

		<div class="controls">
			<div class="transport">
				<button
					class="play"
					class:waiting={mixer.waiting}
					aria-label={mixer.playing ? 'Pause' : 'Play'}
					onclick={togglePlay}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						{#if mixer.playing}
							<path d="M4 2.5h2.6v11H4zM9.4 2.5H12v11H9.4z" />
						{:else}
							<path d="M4.5 2.2 13.5 8l-9 5.8z" />
						{/if}
					</svg>
				</button>
				<div class="time">
					{#if mixer.error}
						<span class="error" title={mixer.error}>Audio failed</span>
					{:else}
						<span>{fmt(t)} / {fmt(mixer.duration)}</span>
					{/if}
					<span class="measure">m. {measure + 1}</span>
				</div>
			</div>

			<div
				class="segmented parts"
				role="group"
				aria-label="Dominant parts"
				title="Shift-click to select several parts"
				{@attach scrollFades}
			>
				<button
					class="all"
					aria-pressed={selected.length === voiceNames.length}
					onclick={() => (selected = voiceNames)}>All</button
				>
				{#each voiceNames as name (name)}
					<button
						style:--c={colors[name]}
						bind:this={partButtons[name]}
						aria-pressed={selectedSet.has(name)}
						onclick={(e) => pick(name, e.shiftKey || e.metaKey)}>{name}</button
					>
				{/each}
			</div>

			<div class="segmented views" role="radiogroup" aria-label="View">
				{#each VIEWS as v (v.id)}
					<button role="radio" aria-checked={view === v.id} onclick={() => (view = v.id)}
						>{v.label}</button
					>
				{/each}
			</div>

			<button
				class="mic"
				class:error={mic.error}
				aria-label="Microphone"
				aria-pressed={mic.active}
				title={mic.error || 'Show the pitch you sing (use headphones)'}
				onclick={toggleMic}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" />
					<path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5" fill="none" />
				</svg>
			</button>
			<button class="mix" popovertarget="mix-panel">Mix</button>
			<div id="mix-panel" class="mix-panel" popover="auto" onbeforetoggle={placeAbove}>
				<label for="emphasis" title="How much quieter the other parts are">Emphasis</label>
				<input id="emphasis" type="range" min="0" max="1" step="0.01" bind:value={emphasis} />
				{#each accompaniment as name (name)}
					<label for="accomp-{name}">{name}</label>
					<input
						id="accomp-{name}"
						type="range"
						min="0"
						max="1"
						step="0.01"
						bind:value={accompLevels[name]}
					/>
				{/each}
			</div>
		</div>

		<div class="hint">
			Space: play/pause · ←/→: previous/next measure · 1–9: pick part, with Shift: add/remove ·
			0: all parts · V: switch view · M: microphone · click a note or syllable to jump there
		</div>
	</footer>
</div>

<style>
	@property --bg-hue {
		syntax: '<number>';
		inherits: true;
		initial-value: 215;
	}

	.player {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		background:
			radial-gradient(ellipse at 50% 0%, hsl(var(--bg-hue) 45% 22%), transparent 70%),
			hsl(var(--bg-hue) 25% 7%);
		transition: --bg-hue 3s;
	}

	header {
		position: relative;
		text-align: center;
		padding: 18px 4vw 0;
	}
	.piece {
		position: absolute;
		left: 4vw;
		top: 18px;
		max-width: 22vw;
		font: inherit;
		color: inherit;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 4px 8px;
	}
	.piece option {
		background: #222;
	}
	h1 {
		margin: 0;
		font: italic 600 30px var(--lyric-font);
		letter-spacing: 0.04em;
	}
	.credits {
		opacity: 0.55;
	}

	.stage {
		flex: 1;
		display: flex;
		flex-direction: column;
		padding: 0 4vw;
		min-height: 0;
		position: relative;
	}
	.bars {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		cursor: pointer;
	}

	footer {
		padding: 0 4vw 14px;
	}
	.sheet {
		display: block;
		width: 100%;
		margin-bottom: 8px;
		cursor: pointer;
	}
	.timeline {
		display: block;
		width: 100%;
		height: 56px;
		cursor: pointer;
		border-radius: 6px;
		background: rgb(255 255 255 / 0.04);
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 10px;
		user-select: none;
	}

	button {
		font: inherit;
		color: inherit;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 5px 14px;
		cursor: pointer;
		white-space: nowrap;
	}
	button:hover {
		background: rgb(255 255 255 / 0.14);
	}

	.transport {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: none;
	}
	.play {
		width: 38px;
		height: 38px;
		padding: 0;
		display: grid;
		place-items: center;
		background: #eee;
		color: #111;
		border: 0;
	}
	.play:hover {
		background: #fff;
	}
	.play.waiting {
		cursor: progress;
		animation: waiting 1s ease-in-out infinite alternate;
	}
	@keyframes waiting {
		to {
			opacity: 0.4;
		}
	}
	.play svg {
		width: 16px;
		height: 16px;
		fill: currentColor;
	}
	.time {
		display: flex;
		flex-direction: column;
		font-size: 12px;
		line-height: 1.3;
		font-variant-numeric: tabular-nums;
		min-width: 7.5em;
		opacity: 0.8;
	}
	.measure {
		opacity: 0.6;
	}
	.error {
		color: #ff8a8a;
	}

	/* A row of buttons inside one pill-shaped track. */
	.segmented {
		display: flex;
		gap: 2px;
		padding: 2px;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.05);
		border: 1px solid var(--border);
	}
	.segmented button {
		border: 0;
		background: transparent;
		padding: 4px 12px;
	}
	.segmented button:hover {
		background: rgb(255 255 255 / 0.1);
	}
	.segmented button:is([aria-pressed='true'], [aria-checked='true']) {
		background: var(--c, #ddd);
		color: #111;
	}

	.parts {
		--fade-start: 0px;
		--fade-end: 0px;
		flex: 0 1 auto;
		min-width: 0;
		margin-inline: auto;
		overflow-x: auto;
		scrollbar-width: none;
		mask-image: linear-gradient(
			to right,
			transparent,
			#000 var(--fade-start),
			#000 calc(100% - var(--fade-end)),
			transparent
		);
	}
	.parts:global(.fade-start) {
		--fade-start: 32px;
	}
	.parts:global(.fade-end) {
		--fade-end: 32px;
	}
	.parts button {
		flex: none;
	}
	.parts button:not(.all) {
		color: var(--c);
	}
	.parts button[aria-pressed='true'] {
		color: #111;
	}

	.views {
		flex: none;
	}
	.mix {
		flex: none;
	}
	.mic {
		flex: none;
		display: grid;
		place-items: center;
		padding: 5px 10px;
	}
	.mic svg {
		width: 16px;
		height: 16px;
		fill: currentColor;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
	}
	.mic[aria-pressed='true'] {
		background: #eee;
		color: #111;
	}
	.mic.error {
		color: #ff8a8a;
	}

	.mix-panel {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: 14px 16px;
		color: inherit;
		background: hsl(var(--bg-hue) 18% 13% / 0.97);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
		gap: 10px 14px;
		grid-template-columns: auto 160px;
		align-items: center;
	}
	.mix-panel:popover-open {
		display: grid;
	}
	.mix-panel label {
		opacity: 0.85;
	}
	.mix-panel input {
		accent-color: #ddd;
	}

	.hint {
		margin-top: 6px;
		font-size: 12px;
		opacity: 0.4;
	}
</style>

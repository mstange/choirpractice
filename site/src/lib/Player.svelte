<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		NOW_X,
		drawBars,
		drawRuler,
		drawSheet,
		drawTimeline,
		type Loop,
		type MicTrace
	} from './canvas.ts';
	import { assignColors } from './colors.ts';
	import { INSTRUMENTS } from './instruments.ts';
	import Lyrics from './Lyrics.svelte';
	import { mediaUrl } from './pieces.ts';
	import { Sheet } from './sheet.ts';
	import type { Saved, Session } from './session.svelte.ts';
	import { Synth } from './synth.svelte.ts';
	import type { PieceData, PieceEntry, View } from './types.ts';

	// The route re-creates this component for each piece, so props other than the view never change
	// after creation. The session outlives it.
	let {
		season,
		entry,
		piece,
		pieces,
		view,
		session
	}: {
		season: string;
		entry: PieceEntry;
		piece: PieceData;
		pieces: PieceEntry[];
		view: View;
		session: Session;
	} = $props();
	// svelte-ignore state_referenced_locally
	const { voices, parts, measures, engravings } = piece;
	// svelte-ignore state_referenced_locally
	const fileUrl = (file: string) => mediaUrl(season, `${entry.slug}/${file}`);

	const SPATIUM_PX = 7; // size of the sheet music: the distance between staff lines
	const BAR_SECONDS = [2, 40]; // how far the Pitch view zooms in and out
	const SPEEDS = [0.5, 1.5]; // the range of playback speeds
	const SPEED_STEP = 0.1; // how much Slower and Faster change the speed
	const PIANO_GAIN = 1; // the gain of the piano that doubles a selected part
	const SELECTED_BOOST = 0.5; // how much louder the selected parts get at full emphasis
	const VIEWS: { id: View; label: string }[] = [
		{ id: 'pitch', label: 'Pitch' },
		{ id: 'lyrics', label: 'Lyrics' }
	];
	const voiceNames = voices.map((v) => v.name);
	const colors = assignColors(voices);
	const accompaniment = parts.filter((p) => !p.vocal).map((p) => p.name);
	// A part with several channels, such as a cello's arco and pizzicato, keeps its instruments.
	const playable = parts.some((p) => p.vocal && p.channels.length === 1);
	const synth = new Synth(
		parts,
		measures[measures.length - 1],
		(file) => mediaUrl('soundfont', file),
		// svelte-ignore state_referenced_locally
		session.vocalProgram
	);

	// Background hue changes at the first syllable starting with each configured word.
	// svelte-ignore state_referenced_locally
	const hueTimes = (entry.hues ?? []).map(([word, hue]) => [
		voices[0].syllables.find((s) => s.text.startsWith(word))?.t0 ?? Infinity,
		hue
	]);

	// svelte-ignore state_referenced_locally
	const mic = session.mic;
	// svelte-ignore state_referenced_locally
	const storageKey = `piece:${season}/${entry.slug}`;
	// svelte-ignore state_referenced_locally
	const saved = session.enter(storageKey, voiceNames);
	let accompLevels = $state(
		Object.fromEntries(
			// svelte-ignore state_referenced_locally
			accompaniment.map((n) => [n, saved.levels?.[n] ?? entry.levels?.[n] ?? 0.6])
		)
	);
	let speed = $state(saved.speed ?? 1);
	// Save once the user changes something, so that a piece they haven't touched keeps taking the
	// selection over from the previous piece.
	let changed = false;
	$effect(() => {
		const saved: Saved = {
			selected: session.selected,
			emphasis: session.emphasis,
			extraPiano: session.extraPiano,
			levels: accompLevels,
			speed
		};
		const json = JSON.stringify(saved);
		if (changed) localStorage.setItem(storageKey, json);
		changed = true;
	});
	let t = $state(0);
	// While "Just me" is hovered, touched or J is held, the other parts take the high emphasis.
	let justMe = $state(false);
	let barsCanvas: HTMLCanvasElement | undefined = $state();
	let rulerCanvas: HTMLCanvasElement | undefined = $state();
	let timelineCanvas: HTMLCanvasElement;
	const partButtons: Record<string, HTMLButtonElement> = {};
	const micTrace: MicTrace = { trail: [], now: null, shift: 0 };

	const sheets = engravings.map((e) => new Sheet(e, fileUrl(e.file)));
	// A single selected part gets its own engraving; several get the one with all vocal parts.
	const sheet = $derived(
		sheets.find((s) =>
			session.selected.length === 1
				? s.info.parts.join() === session.selected[0]
				: s.info.parts.length > 1
		) ?? null
	);
	let sheetCanvas: HTMLCanvasElement | undefined = $state();
	let sheetFrozen = false;
	let windowHeight = $state(0);
	// Staves the same size in every piece, unless the sheet would take more than a third of the window.
	const sheetHeight = $derived(
		sheet && Math.min((sheet.info.height / sheet.info.spatium) * SPATIUM_PX, windowHeight / 3)
	);
	let loop = $state<Loop | null>(null);
	const loopTimes = $derived<[number, number] | null>(
		loop?.on ? [measures[loop.from], measures[loop.to]] : null
	);
	$effect(() => synth.setLoop(loopTimes));
	$effect(() => synth.setSpeed(speed));
	$effect(() => {
		synth.setVocalProgram(session.vocalProgram);
	});
	const selectedSet = $derived(new Set(session.selected));
	// The Just me button flows with the selected parts' colors, one part's with a lighter shade of
	// it. The colors come twice, so that sliding the gradient by half its width starts it over.
	const justMeGradient = $derived.by(() => {
		const cs = session.selected.map((n) => colors[n]);
		if (cs.length === 1) cs.push(`color-mix(in oklab, ${cs[0]} 45%, white)`);
		return `linear-gradient(90deg, ${[...cs, ...cs, cs[0]].join(', ')})`;
	});
	const measure = $derived(measureAt(t));
	const hue = $derived(
		hueTimes.filter(([st]) => st <= t + 1).pop()?.[1] ?? hueTimes[0]?.[1] ?? 215
	);

	$effect(() => {
		// Emphasis makes the selected parts louder, the other vocal parts quieter and the
		// accompaniment quieter still, silent at full emphasis.
		const emphasis = session.emphasis[justMe ? 1 : 0];
		const selected = 1 + SELECTED_BOOST * emphasis;
		for (const { name, vocal } of parts) {
			const isSelected = session.selected.includes(name);
			const gain = !vocal
				? accompLevels[name] * (1 - emphasis)
				: isSelected
					? selected
					: 1 - 0.9 * emphasis;
			synth.setGain(name, gain);
			const piano = session.extraPiano && isSelected;
			if (vocal) synth.setPianoGain(name, piano ? PIANO_GAIN * selected : 0);
		}
	});

	onMount(() => {
		synth.load(fileUrl('score.mid'));
		let raf = requestAnimationFrame(function frame() {
			t = synth.now();
			if (synth.playing && !synth.held && t >= synth.duration) synth.pause();
			if (mic.active) recordMic();
			if (view !== 'lyrics' && barsCanvas && rulerCanvas) {
				drawBars(
					barsCanvas,
					piece,
					colors,
					t,
					session.barSeconds,
					selectedSet,
					mic.active ? micTrace : null,
					loop
				);
				drawRuler(rulerCanvas, measures, t, session.barSeconds, loop);
			}
			if (sheet && sheetCanvas)
				drawSheet(sheetCanvas, sheet, t, colors[session.selected[0]], sheetFrozen);
			drawTimeline(timelineCanvas, piece, colors, t, loopTimes);
			raf = requestAnimationFrame(frame);
		});
		return () => {
			cancelAnimationFrame(raf);
			synth.close();
		};
	});

	/** Adds the mic's current pitch to the trail, which follows the playhead. */
	function recordMic() {
		// The delays are in seconds, and the trail in seconds of the score.
		micTrace.now = mic.read();
		micTrace.shift = session.micDelay * synth.speed;
		if (!synth.playing || synth.waiting) return;
		const at = t - mic.delay * synth.speed,
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
		synth.seek(time);
		t = synth.now();
	}

	/** Goes to the start of the loop while looping is on, else to the start of the piece. */
	function toStart() {
		seek(loopTimes ? loopTimes[0] : 0);
	}

	/** Goes to the start of the next measure, or of the previous one if it is just past this one's. */
	function stepMeasure(d: 1 | -1) {
		const m = measureAt(t + 0.3) + d;
		seek(measures[Math.max(0, Math.min(m, measures.length - 2))]);
	}

	/** Goes to the next multiple of the speed step, faster or slower. */
	function stepSpeed(d: 1 | -1) {
		const steps = speed / SPEED_STEP;
		const next = (d > 0 ? Math.floor(steps + 1e-6) + 1 : Math.ceil(steps - 1e-6) - 1) * SPEED_STEP;
		speed = Math.round(Math.min(Math.max(next, SPEEDS[0]), SPEEDS[1]) * 100) / 100;
	}

	function togglePlay() {
		if (synth.playing) return synth.pause();
		if (loopTimes && (t < loopTimes[0] || t >= loopTimes[1])) seek(loopTimes[0]);
		synth.play();
	}

	// The view is part of the URL. Switching it replaces the history entry, so that Back goes to the
	// previous piece rather than the previous view.
	function show(slug: string, v: View) {
		const url = resolve('/[season]/[slug]/[[view=view]]', {
			season,
			slug,
			view: v === 'lyrics' ? v : undefined
		});
		if (slug === entry.slug) goto(url, { replace: true, reset: false });
		else goto(url);
	}

	/** Selects a single part, or with `extend`, adds it to or removes it from the selection. */
	function pick(name: string, extend: boolean) {
		if (!extend) session.selected = [name];
		else if (!session.selected.includes(name))
			session.selected = voiceNames.filter((n) => n === name || session.selected.includes(n));
		else if (session.selected.length > 1)
			session.selected = session.selected.filter((n) => n !== name);
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

	/**
	 * Lets a pointer move the playhead along an element. Playback holds while the pointer is down
	 * and resumes on release if it was playing. `timeAt` gets the pointer's x position within the
	 * element, and returns where to seek, or null for nowhere. `d.moved` says whether the pointer
	 * has moved since it went down, which tells a click from a drag.
	 */
	type Drag = { x0: number; t0: number; moved: boolean; up: boolean };
	function scrub(
		timeAt: (x: number, width: number, d: Drag) => number | null,
		onhold?: (held: boolean) => void
	) {
		return (el: HTMLElement) => {
			const ondown = (down: PointerEvent) => {
				if (!down.isPrimary || down.button !== 0) return;
				el.setPointerCapture(down.pointerId);
				const rect = el.getBoundingClientRect();
				const xOf = (e: PointerEvent) => Math.max(0, Math.min(e.clientX - rect.left, rect.width));
				const d: Drag = { x0: xOf(down), t0: t, moved: false, up: false };
				const update = (e: PointerEvent) => {
					d.moved ||= Math.abs(xOf(e) - d.x0) > 4;
					const time = timeAt(xOf(e), rect.width, d);
					if (time !== null) seek(time);
				};
				const done = new AbortController();
				const end = (e: PointerEvent) => {
					d.up = e.type === 'pointerup';
					if (d.up) update(e);
					done.abort();
					onhold?.(false);
					synth.release();
				};
				synth.hold();
				onhold?.(true);
				update(down);
				el.addEventListener('pointermove', update, { signal: done.signal });
				el.addEventListener('pointerup', end, { signal: done.signal });
				el.addEventListener('pointercancel', end, { signal: done.signal });
			};
			el.addEventListener('pointerdown', ondown);
			return () => el.removeEventListener('pointerdown', ondown);
		};
	}

	// Dragging pans the bars; a click without moving seeks to where it is.
	const scrubBars = scrub((x, w, d) =>
		pinching
			? null
			: d.moved
				? d.t0 - ((x - d.x0) / w) * session.barSeconds
				: d.up
					? d.t0 + (x / w - NOW_X) * session.barSeconds
					: null
	);
	// The page stands still while the cursor follows the pointer, rather than turning as soon as
	// the cursor gets near its end.
	const scrubSheet = scrub(
		(x) => sheet && sheet.timeAt(x),
		(held) => (sheetFrozen = held)
	);
	const scrubTimeline = scrub((x, w) => (x / w) * synth.duration);

	/**
	 * The ruler above the bars holds the loop. Dragging along it makes a loop over the measures it
	 * covers, dragging the loop's ends or middle resizes or moves it, and tapping it turns looping
	 * on or off. Tapping elsewhere seeks to that measure.
	 */
	function loopRuler(el: HTMLElement) {
		const last = measures.length - 1;
		const xOf = (e: PointerEvent) => e.clientX - el.getBoundingClientRect().left;
		const timeAt = (x: number) => t + (x / el.clientWidth - NOW_X) * session.barSeconds;
		const xAt = (time: number) => (NOW_X + (time - t) / session.barSeconds) * el.clientWidth;
		// The start of the measure nearest to a time.
		const nearest = (time: number) => {
			const m = measureAt(time);
			return time - measures[m] > measures[m + 1] - time ? m + 1 : m;
		};
		const hit = (x: number, touch: boolean) => {
			if (!loop) return 'new';
			const x0 = xAt(measures[loop.from]),
				x1 = xAt(measures[loop.to]);
			const reach = Math.min(touch ? 14 : 6, (x1 - x0) / 3);
			if (Math.abs(x - x0) < reach) return 'from';
			if (Math.abs(x - x1) < reach) return 'to';
			return x0 < x && x < x1 ? 'move' : 'new';
		};
		const onhover = (e: PointerEvent) => {
			if (e.buttons) return;
			const mode = hit(xOf(e), e.pointerType !== 'mouse');
			el.style.cursor = mode === 'from' || mode === 'to' ? 'ew-resize' : 'pointer';
		};
		const ondown = (down: PointerEvent) => {
			if (!down.isPrimary || down.button !== 0) return;
			el.setPointerCapture(down.pointerId);
			const x0 = xOf(down),
				t0 = timeAt(x0),
				mode = hit(x0, down.pointerType !== 'mouse'),
				start = loop;
			let moved = false;
			const update = (e: PointerEvent) => {
				moved ||= Math.abs(xOf(e) - x0) > 4;
				if (!moved || pinching) return;
				const time = timeAt(xOf(e));
				if (mode === 'new' || !start) {
					const [a, b] = [measureAt(t0), measureAt(time)];
					loop = { from: Math.min(a, b), to: Math.max(a, b) + 1, on: true };
				} else if (mode === 'from') {
					loop = { ...start, from: Math.min(nearest(time), start.to - 1) };
				} else if (mode === 'to') {
					loop = { ...start, to: Math.max(nearest(time), start.from + 1) };
				} else {
					const d = Math.max(-start.from, Math.min(nearest(time) - nearest(t0), last - start.to));
					loop = { ...start, from: start.from + d, to: start.to + d };
				}
			};
			const done = new AbortController();
			const end = (e: PointerEvent) => {
				done.abort();
				if (moved || pinching || e.type !== 'pointerup') return;
				if (mode === 'new' || !start) seek(measures[measureAt(timeAt(xOf(e)))]);
				else loop = { ...start, on: !start.on };
			};
			el.addEventListener('pointermove', update, { signal: done.signal });
			el.addEventListener('pointerup', end, { signal: done.signal });
			el.addEventListener('pointercancel', end, { signal: done.signal });
		};
		el.addEventListener('pointermove', onhover);
		el.addEventListener('pointerdown', ondown);
		return () => {
			el.removeEventListener('pointermove', onhover);
			el.removeEventListener('pointerdown', ondown);
		};
	}

	/** Shows `seconds` of music across the Pitch view, keeping the "now" line where it is. */
	function setBarSeconds(seconds: number) {
		session.barSeconds = Math.min(Math.max(seconds, BAR_SECONDS[0]), BAR_SECONDS[1]);
	}

	/**
	 * Zooms the Pitch view with ctrl+wheel and with two-finger pinches. A trackpad pinch arrives as
	 * ctrl+wheel with many small pixel deltas: the OS's magnification scaled by about 100, so
	 * exp(-deltaY / 100) matches the browser's own pinch-zoom. A mouse wheel notch is a single
	 * delta of about 100 px, and coalesced events have larger deltas, so a single event zooms by at
	 * most 1.25. Touch pinches hold the drags, which check `pinching`, until all fingers are up.
	 */
	let pinching = false;
	function zoomable(el: HTMLElement) {
		const onwheel = (e: WheelEvent) => {
			if (!e.ctrlKey || view === 'lyrics') return;
			e.preventDefault();
			const factor = e.deltaMode
				? 2 ** (-e.deltaY * (e.deltaMode === 1 ? 0.05 : 1))
				: Math.min(Math.max(Math.exp(-e.deltaY / 100), 1 / 1.25), 1.25);
			setBarSeconds(session.barSeconds / factor);
		};
		const touches = new Map<number, [number, number]>();
		let spread0 = 0,
			seconds0 = 0;
		const spread = () => {
			const [[x0, y0], [x1, y1]] = touches.values();
			return Math.hypot(x1 - x0, y1 - y0);
		};
		// Two fingers zoom from the spread and scale they had when the second one came down.
		const restart = () => {
			spread0 = touches.size === 2 ? spread() : 0;
			seconds0 = session.barSeconds;
			pinching ||= touches.size > 1;
			if (!touches.size) pinching = false;
		};
		const ondown = (e: PointerEvent) => {
			if (e.pointerType !== 'touch' || view === 'lyrics') return;
			touches.set(e.pointerId, [e.clientX, e.clientY]);
			restart();
		};
		const onmove = (e: PointerEvent) => {
			if (!touches.has(e.pointerId)) return;
			touches.set(e.pointerId, [e.clientX, e.clientY]);
			if (spread0) setBarSeconds((seconds0 * spread0) / Math.max(spread(), 1));
		};
		const onup = (e: PointerEvent) => {
			if (touches.delete(e.pointerId)) restart();
		};
		const listeners = [
			['wheel', onwheel],
			['pointerdown', ondown],
			['pointermove', onmove],
			['pointerup', onup],
			['pointercancel', onup]
		] as const;
		for (const [type, f] of listeners)
			el.addEventListener(type, f as EventListener, { passive: false });
		return () => {
			for (const [type, f] of listeners) el.removeEventListener(type, f as EventListener);
		};
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
			stepMeasure(e.key === 'ArrowRight' ? 1 : -1);
		} else if (e.key === 'Home') {
			toStart();
		} else if (e.key === '-') {
			stepSpeed(-1);
		} else if (e.key === '+' || e.key === '=') {
			stepSpeed(1);
		} else if (digit === '0') {
			session.selected = voiceNames;
		} else if (digit && voiceNames[+digit - 1]) {
			pick(voiceNames[+digit - 1], e.shiftKey);
		} else if ((e.key === 'l' || e.key === 'L') && loop) {
			loop = { ...loop, on: !loop.on };
		} else if (e.key === 'j' || e.key === 'J') {
			justMe = true;
		} else if (e.key === 'm' || e.key === 'M') {
			toggleMic();
		} else if (e.key === 'v' || e.key === 'V') {
			show(entry.slug, VIEWS[(VIEWS.findIndex((v) => v.id === view) + 1) % VIEWS.length].id);
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

	// Anchor positioning isn't available everywhere yet, so place a panel above its button, lined up
	// with the button's edge that is nearer to the window's edge.
	function placeAbove(e: ToggleEvent) {
		if (e.newState !== 'open') return;
		const panel = e.currentTarget as HTMLElement;
		const button = document.querySelector(`[popovertarget="${panel.id}"]`)!;
		const rect = button.getBoundingClientRect();
		const width = document.documentElement.clientWidth;
		if (rect.left + rect.right < width) panel.style.left = `${rect.left}px`;
		else panel.style.right = `${width - rect.right}px`;
		panel.style.bottom = `${innerHeight - rect.top + 8}px`;
	}
</script>

<svelte:window
	{onkeydown}
	onkeyup={(e) => {
		if (e.key === 'j' || e.key === 'J') justMe = false;
	}}
	onblur={() => (justMe = false)}
	bind:innerHeight={windowHeight}
/>
<svelte:head><title>{piece.title}</title></svelte:head>

<div class="player" style:--bg-hue={hue}>
	<header>
		<select
			class="piece"
			aria-label="Piece"
			value={entry.slug}
			onchange={(e) => show(e.currentTarget.value, view)}
		>
			{#each pieces as p (p.slug)}
				<option value={p.slug}>{p.label}</option>
			{/each}
		</select>
		<div class="title">
			<h1>{piece.title}</h1>
			<div class="credits">
				{[piece.subtitle, piece.credits].filter(Boolean).join(' · ')}
			</div>
		</div>
		<div class="segmented views" role="radiogroup" aria-label="View">
			{#each VIEWS as v (v.id)}
				<button role="radio" aria-checked={view === v.id} onclick={() => show(entry.slug, v.id)}
					>{v.label}</button
				>
			{/each}
		</div>
	</header>

	<main class="stage" {@attach zoomable}>
		{#if view === 'lyrics'}
			<Lyrics {voices} {colors} selected={selectedSet} {t} onseek={seek} />
		{:else}
			<canvas
				class="bars"
				title="Drag to scroll, click to seek"
				bind:this={barsCanvas}
				{@attach scrubBars}
			></canvas>
			<canvas
				class="ruler"
				title="Drag to set a loop, click it to turn looping on or off"
				bind:this={rulerCanvas}
				{@attach loopRuler}
			></canvas>
		{/if}
	</main>

	<footer>
		{#if view === 'pitch' && sheet}
			<canvas
				class="sheet"
				style:height="{sheetHeight}px"
				title="Click or drag to seek"
				bind:this={sheetCanvas}
				{@attach scrubSheet}
			></canvas>
		{/if}
		<canvas
			class="timeline"
			title="Click or drag to seek"
			bind:this={timelineCanvas}
			{@attach scrubTimeline}
		></canvas>

		<div class="controls">
			<div class="transport">
				<button
					class="icon"
					aria-label="Back to the start"
					title="Back to the start (Home)"
					onclick={toStart}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h2v10H3zM13.5 3v10L6 8z" /></svg>
				</button>
				<button
					class="icon"
					aria-label="Previous measure"
					title="Previous measure (←)"
					onclick={() => stepMeasure(-1)}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"
						><path d="M8 3.5v9L1.5 8zM14.5 3.5v9L8 8z" /></svg
					>
				</button>
				<button
					class="play"
					class:waiting={synth.waiting}
					aria-label={synth.playing ? 'Pause' : 'Play'}
					title={synth.playing ? 'Pause (Space)' : 'Play (Space)'}
					onclick={togglePlay}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						{#if synth.playing}
							<path d="M4 2.5h2.6v11H4zM9.4 2.5H12v11H9.4z" />
						{:else}
							<path d="M4.5 2.2 13.5 8l-9 5.8z" />
						{/if}
					</svg>
				</button>
				<button
					class="icon"
					aria-label="Next measure"
					title="Next measure (→)"
					onclick={() => stepMeasure(1)}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"
						><path d="M8 3.5v9L14.5 8zM1.5 3.5v9L8 8z" /></svg
					>
				</button>
			</div>
			<div class="time">
				{#if synth.error}
					<span class="error" title={synth.error}>Audio failed</span>
				{:else}
					<span>{fmt(t)} / {fmt(synth.duration)}</span>
				{/if}
				<span class="measure">m. {measure + 1}</span>
			</div>

			<div class="segmented speed" role="group" aria-label="Speed">
				<button
					aria-label="Slower"
					title="Slower (−)"
					disabled={speed <= SPEEDS[0]}
					onclick={() => stepSpeed(-1)}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9" /></svg>
				</button>
				<button
					class="speed-value"
					class:changed={speed !== 1}
					title="How fast the music plays; click for normal speed"
					onclick={() => (speed = 1)}><span>{Math.round(speed * 100)}%</span></button
				>
				<button
					aria-label="Faster"
					title="Faster (+)"
					disabled={speed >= SPEEDS[1]}
					onclick={() => stepSpeed(1)}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9" /></svg>
				</button>
			</div>

			<div class="who">
				<div
					class="segmented parts"
					role="group"
					aria-label="Dominant parts"
					title="Shift-click to select several parts"
					{@attach scrollFades}
				>
					<button
						class="all"
						aria-pressed={session.selected.length === voiceNames.length}
						onclick={() => (session.selected = voiceNames)}>All</button
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

				<!-- On narrow screens the parts don't fit in a row, and touch screens have no Shift. -->
				<button class="parts-menu" popovertarget="parts-panel" aria-label="Dominant parts">
					<span class="label">
						{#if session.selected.length === voiceNames.length}
							All parts
						{:else}
							{#each session.selected as name, i (name)}
								{#if i},{/if}
								<span style:color={colors[name]}>{name}</span>
							{/each}
						{/if}
					</span>
					<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
				</button>
				<div id="parts-panel" class="parts-panel" popover="auto" onbeforetoggle={placeAbove}>
					<button
						class="solo"
						aria-pressed={session.selected.length === voiceNames.length}
						onclick={(e) => {
							session.selected = voiceNames;
							e.currentTarget.closest<HTMLElement>('[popover]')!.hidePopover();
						}}>All</button
					>
					<span></span>
					{#each voiceNames as name (name)}
						<button
							class="solo"
							style:--c={colors[name]}
							aria-pressed={session.selected.length === 1 && session.selected[0] === name}
							onclick={(e) => {
								pick(name, false);
								e.currentTarget.closest<HTMLElement>('[popover]')!.hidePopover();
							}}>{name}</button
						>
						<button
							class="add"
							role="checkbox"
							style:--c={colors[name]}
							aria-checked={selectedSet.has(name)}
							aria-label="Also {name}"
							onclick={() => pick(name, true)}
						>
							<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
						</button>
					{/each}
				</div>

				<!-- A touch is captured by the button until it ends, so enter and leave also cover a touch
			     that is held. -->
				<button
					class="just-me"
					class:active={justMe}
					style:--gradient={justMeGradient}
					style:--glow={colors[session.selected[0]]}
					disabled={session.selected.length === voiceNames.length}
					title="Hover or hold to make the other parts quieter still (or hold J)"
					onpointerenter={() => (justMe = true)}
					onpointerleave={() => (justMe = false)}
					oncontextmenu={(e) => e.preventDefault()}
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<circle cx="8" cy="8" r="2.5" />
						<circle cx="8" cy="8" r="6" fill="none" />
					</svg>
					Just me
				</button>
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
				<label
					for="emphasis"
					title="How much quieter the other parts are, normally and while Just me is held"
					>Emphasis</label
				>
				<!-- Two range inputs on top of each other, of which only the thumbs take the pointer. When
				     the thumbs meet, the one that can still move away from the end it is near is on top. -->
				<div
					class="range-pair"
					class:low-on-top={session.emphasis[0] > 0.5}
					style:--low={session.emphasis[0]}
					style:--high={session.emphasis[1]}
				>
					<input
						id="emphasis"
						type="range"
						min="0"
						max="1"
						step="0.01"
						value={session.emphasis[0]}
						oninput={(e) => {
							const high = session.emphasis[1];
							// The input moves on past the other thumb unless held back here.
							e.currentTarget.value = String(Math.min(+e.currentTarget.value, high));
							session.emphasis = [+e.currentTarget.value, high];
						}}
					/>
					<input
						type="range"
						aria-label="Emphasis while Just me is held"
						min="0"
						max="1"
						step="0.01"
						value={session.emphasis[1]}
						oninput={(e) => {
							const low = session.emphasis[0];
							e.currentTarget.value = String(Math.max(+e.currentTarget.value, low));
							session.emphasis = [low, +e.currentTarget.value];
						}}
					/>
				</div>
				<label
					class="check"
					title="A piano also plays the selected parts, to make their notes' starts clearer"
				>
					<input type="checkbox" bind:checked={session.extraPiano} />
					Extra Piano
				</label>
				<label for="mic-delay" title="Shifts the pitch you sing back, to line up with the music"
					>Mic delay</label
				>
				<div class="with-value">
					<input
						id="mic-delay"
						type="range"
						min="0"
						max="0.5"
						step="0.01"
						bind:value={session.micDelay}
					/>
					<output for="mic-delay">{Math.round(session.micDelay * 1000)} ms</output>
				</div>
				{#if playable}
					<label for="vocal-instrument" title="The instrument that plays the vocal parts"
						>Vocal Instrument</label
					>
					<select id="vocal-instrument" bind:value={session.vocalProgram}>
						{#each INSTRUMENTS as [program, label] (program)}
							<option value={program}>{label}</option>
						{/each}
					</select>
				{/if}
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
			Space: play/pause · ←/→: previous/next measure · Home: back to the start · −/+: slower/faster
			· 1–9: pick part, with Shift: add/remove · 0: all parts · hold J: just me · V: switch view ·
			M: microphone · L: loop on/off · Ctrl+wheel: zoom · drag the notes to scroll, click a note or
			syllable to jump there · drag along the measure numbers to set a loop
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
		/* Nothing may widen the page, such as the lyrics' ball following a syllable off the edge. On a
		   phone that would make the whole page zoomable and scrollable. */
		overflow: clip;
		display: flex;
		flex-direction: column;
		background:
			radial-gradient(ellipse at 50% 0%, hsl(var(--bg-hue) 45% 22%), transparent 70%),
			hsl(var(--bg-hue) 25% 7%);
		transition: --bg-hue 3s;
	}

	/* What is shown: the piece on the left, the view on the right. */
	header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: start;
		gap: 12px;
		padding: 14px 4vw 0;
	}
	.piece {
		justify-self: start;
		max-width: 100%;
		font: inherit;
		color: inherit;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 5px 10px;
	}
	.title {
		text-align: center;
		min-width: 0;
	}
	.views {
		justify-self: end;
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
		cursor: grab;
		touch-action: none;
	}

	.ruler {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 24px;
		cursor: pointer;
		touch-action: none;
	}

	footer {
		padding: 0 4vw 14px;
	}
	.sheet {
		display: block;
		width: 100%;
		margin-bottom: 8px;
		cursor: pointer;
		touch-action: none;
	}
	.timeline {
		display: block;
		width: 100%;
		height: 56px;
		cursor: pointer;
		touch-action: none;
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

	/* What is played: transport, speed, who sings, and the mix. */
	.transport {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: none;
	}
	/* Round, borderless buttons with just an icon. */
	.icon {
		width: 34px;
		height: 34px;
		padding: 0;
		display: grid;
		place-items: center;
		background: transparent;
		border: 0;
		opacity: 0.85;
	}
	.icon:hover {
		opacity: 1;
	}
	.icon svg {
		width: 15px;
		height: 15px;
		fill: currentColor;
	}
	.play {
		width: 44px;
		height: 44px;
		margin-inline: 2px;
		padding: 0;
		display: grid;
		place-items: center;
		background: #eee;
		color: #111;
		border: 0;
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.35);
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
		white-space: nowrap;
		min-width: 6.5em;
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
	.segmented button:disabled {
		opacity: 0.35;
		background: transparent;
		cursor: default;
	}

	.speed {
		flex: none;
		align-items: center;
	}
	.speed button:not(.speed-value) {
		display: grid;
		place-items: center;
		padding: 4px 8px;
	}
	.speed svg {
		width: 14px;
		height: 14px;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
	}
	/* As wide as the widest value, bold, whatever the value is. */
	.speed-value {
		display: grid;
		justify-items: center;
		font-variant-numeric: tabular-nums;
	}
	.speed-value::before {
		content: '000%';
		font-weight: 600;
		visibility: hidden;
	}
	.speed-value::before,
	.speed-value span {
		grid-area: 1 / 1;
	}
	.speed-value span {
		opacity: 0.8;
	}
	.speed-value.changed span {
		opacity: 1;
		font-weight: 600;
	}

	.who {
		flex: 0 1 auto;
		min-width: 0;
		margin-inline: auto;
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.parts {
		--fade-start: 0px;
		--fade-end: 0px;
		flex: 0 1 auto;
		min-width: 0;
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

	.parts-menu {
		display: none;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 0;
	}
	.parts-menu .label {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.parts-menu svg {
		flex: none;
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0.7;
	}
	.parts-panel {
		position: fixed;
		inset: auto;
		margin: 0;
		padding: 6px;
		color: inherit;
		background: hsl(var(--bg-hue) 18% 13% / 0.97);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
		grid-template-columns: auto auto;
		gap: 2px 6px;
		max-height: 60dvh;
		overflow-y: auto;
	}
	.parts-panel:popover-open {
		display: grid;
	}
	.parts-panel button {
		border: 0;
		background: transparent;
		padding: 8px 14px;
	}
	.parts-panel button:hover {
		background: rgb(255 255 255 / 0.1);
	}
	.parts-panel .solo {
		text-align: left;
		color: var(--c, inherit);
	}
	.parts-panel .solo[aria-pressed='true'] {
		background: var(--c, #ddd);
		color: #111;
	}
	.parts-panel .add {
		display: grid;
		place-items: center;
		padding: 8px 10px;
	}
	.parts-panel .add svg {
		width: 18px;
		height: 18px;
		padding: 2px;
		box-sizing: border-box;
		border: 1.5px solid var(--c);
		border-radius: 4px;
		fill: none;
		stroke: transparent;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.parts-panel .add[aria-checked='true'] svg {
		background: var(--c);
		stroke: #111;
	}

	/* Just me is held rather than clicked, so it doesn't look like the other buttons: it has a
	   border in the selected parts' colors, and while held it fills with them, flowing and glowing. */
	.just-me,
	.just-me:hover {
		flex: none;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 14px 5px 11px;
		font-weight: 600;
		border: 1.5px solid transparent;
		background:
			linear-gradient(hsl(var(--bg-hue) 20% 11%), hsl(var(--bg-hue) 20% 11%)) padding-box,
			var(--gradient) border-box;
		background-size:
			100% 100%,
			200% 100%;
		touch-action: none;
		-webkit-touch-callout: none;
	}
	.just-me svg {
		width: 14px;
		height: 14px;
		fill: currentColor;
		stroke: currentColor;
		stroke-width: 1.5;
	}
	.just-me.active {
		color: #111;
		background: var(--gradient) border-box;
		background-size: 200% 100%;
		animation:
			flow 1.6s linear infinite,
			glow 1.2s ease-in-out infinite alternate;
	}
	@keyframes flow {
		to {
			background-position: 100% 0;
		}
	}
	@keyframes glow {
		from {
			box-shadow: 0 0 6px 0 color-mix(in srgb, var(--glow) 50%, transparent);
		}
		to {
			box-shadow: 0 0 18px 4px color-mix(in srgb, var(--glow) 70%, transparent);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.just-me.active {
			animation: none;
			box-shadow: 0 0 14px 2px color-mix(in srgb, var(--glow) 60%, transparent);
		}
	}
	.just-me:disabled {
		opacity: 0.35;
		cursor: default;
	}

	/* Too narrow for one row: transport, time and speed in the first, who sings, mic and mix in
	   the second. */
	@media (max-width: 1050px) {
		.controls {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr) auto auto;
			grid-template-areas: 'transport time speed speed' 'who who mic mix';
			gap: 8px;
		}
		.transport {
			grid-area: transport;
		}
		.time {
			grid-area: time;
			min-width: 0;
		}
		.speed {
			grid-area: speed;
		}
		.who {
			grid-area: who;
			margin: 0;
		}
		.mic {
			grid-area: mic;
		}
		.mix {
			grid-area: mix;
		}
	}

	@media (max-width: 700px) {
		header {
			grid-template-columns: minmax(0, 1fr) auto;
			grid-template-areas: 'piece views' 'title title';
			row-gap: 6px;
		}
		.piece {
			grid-area: piece;
		}
		.views {
			grid-area: views;
		}
		.title {
			grid-area: title;
		}
		h1 {
			font-size: 24px;
		}
		.icon {
			width: 30px;
		}
		.speed button:not(.speed-value) {
			padding-inline: 6px;
		}
		.parts {
			display: none;
		}
		.parts-menu {
			display: flex;
			flex: 1;
		}
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
		max-height: 70dvh;
		overflow-y: auto;
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
	.mix-panel input[type='checkbox'] {
		margin: 0;
	}
	.mix-panel .check {
		grid-column: 2;
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: -4px;
	}
	.mix-panel select {
		font: inherit;
		color: inherit;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 2px 6px;
	}
	.mix-panel option {
		background: #222;
	}
	.range-pair {
		--track: 4px;
		--thumb: 16px;
		position: relative;
		height: var(--thumb);
		/* The track, with the part between the thumbs filled. The thumbs' centers travel over the
		   width less one thumb. */
		background:
			linear-gradient(
					to right,
					transparent calc(var(--thumb) / 2 + var(--low) * (100% - var(--thumb))),
					#ddd 0 calc(var(--thumb) / 2 + var(--high) * (100% - var(--thumb))),
					transparent 0
				)
				center / 100% var(--track) no-repeat,
			linear-gradient(rgb(255 255 255 / 0.25), rgb(255 255 255 / 0.25)) center / 100% var(--track)
				no-repeat;
		border-radius: 999px;
	}
	.range-pair input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		appearance: none;
		background: transparent;
		pointer-events: none;
	}
	.range-pair.low-on-top input:first-child {
		z-index: 1;
	}
	.range-pair input:focus-visible {
		outline: none;
	}
	.range-pair input::-webkit-slider-runnable-track {
		height: 100%;
		background: transparent;
	}
	.range-pair input::-moz-range-track {
		background: transparent;
	}
	.range-pair input::-webkit-slider-thumb {
		appearance: none;
		width: var(--thumb);
		height: var(--thumb);
		border: 0;
		border-radius: 50%;
		background: #ddd;
		pointer-events: auto;
		cursor: pointer;
	}
	.range-pair input::-moz-range-thumb {
		width: var(--thumb);
		height: var(--thumb);
		border: 0;
		border-radius: 50%;
		background: #ddd;
		pointer-events: auto;
		cursor: pointer;
	}
	.range-pair input:focus-visible::-webkit-slider-thumb {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}
	.range-pair input:focus-visible::-moz-range-thumb {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}
	.with-value {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.with-value input {
		flex: 1;
		min-width: 0;
	}
	.with-value output {
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		min-width: 4em;
		text-align: right;
		opacity: 0.7;
	}

	.hint {
		margin-top: 6px;
		font-size: 12px;
		opacity: 0.4;
	}
	@media (hover: none) {
		.hint {
			display: none;
		}
	}
</style>

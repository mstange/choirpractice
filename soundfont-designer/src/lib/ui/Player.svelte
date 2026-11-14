<script lang="ts">
	import { untrack } from 'svelte';
	import type { Built } from '../build-worker.ts';
	import { DESIGNED, DesignerSynth, INSTRUMENTS, type Part } from '../designer-synth.ts';
	import { partColor, prepare } from './canvas.ts';

	type Season = { id: string; title: string; pieces: { slug: string; label: string }[] };
	type Piece = { title: string; parts: Part[]; measures: number[] };

	let { built, synth = $bindable() }: { built: Built | null; synth: DesignerSynth | null } =
		$props();

	const STORE = 'soundfont-designer:player';
	const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
	let seasons = $state<Season[]>([]);
	let choice = $state<string>(saved.choice ?? 'demo/ave-verum-corpus');
	let voice = $state<number>(saved.voice ?? DESIGNED);
	/** The vocal part that is heard above the others, or '' for all alike. */
	let focus = $state<string>(saved.focus ?? '');
	/** dB of the other vocal parts while one has the focus. */
	let others = $state<number>(saved.others ?? -12);
	let accompaniment = $state<number>(saved.accompaniment ?? 0.5);
	let speed = $state(1);
	let looping = $state(false),
		loopFrom = $state(1),
		loopTo = $state(4);
	let piece = $state.raw<Piece | null>(null);
	let now = $state(0);
	let error = $state('');

	fetch('media/seasons.json')
		.then((r) => r.json())
		.then((s) => (seasons = s))
		.catch((e) => (error = `No seasons: ${e}`));

	$effect(() => {
		localStorage.setItem(STORE, JSON.stringify({ choice, voice, focus, others, accompaniment }));
	});

	// A new synthesizer for each piece.
	$effect(() => {
		const base = `media/${choice}/`;
		let s: DesignerSynth | null = null,
			cancelled = false;
		error = '';
		fetch(`${base}piece.json`)
			.then((r) => (r.ok ? r.json() : Promise.reject(`${r.url}: ${r.status}`)))
			.then((p: Piece) => {
				if (cancelled) return;
				piece = p;
				s = new DesignerSynth(
					p.parts,
					p.measures.at(-1)!,
					(program) => `media/soundfont/${program}.sf3`,
					untrack(() => voice)
				);
				synth = s;
				s.load(`${base}score.mid`);
			})
			.catch((e) => (error = String(e)));
		return () => {
			cancelled = true;
			s?.close();
			synth = null;
			piece = null;
		};
	});

	$effect(() => {
		if (!synth || !built) return;
		const s = synth,
			b = built;
		untrack(() =>
			s.setBank(
				b.file.slice(0),
				b.samples.map(({ index, data }) => ({ index, data: data.slice() }))
			)
		);
	});
	$effect(() => void synth?.setVoice(voice));
	$effect(() => synth?.setSpeed(speed));
	$effect(() => {
		if (!synth || !piece) return;
		for (const p of piece.parts)
			synth.setGain(
				p.name,
				!p.vocal ? accompaniment : focus && p.name !== focus ? 10 ** (others / 20) : 1
			);
	});
	$effect(() => {
		if (!synth || !piece) return;
		const m = piece.measures,
			from = Math.max(1, Math.min(loopFrom, m.length - 1)),
			to = Math.max(from, Math.min(loopTo, m.length - 1));
		synth.setLoop(looping ? [m[from - 1], m[to]] : null);
	});
	$effect(() => {
		let frame = 0;
		const tick = () => {
			now = synth?.now() ?? 0;
			frame = requestAnimationFrame(tick);
		};
		tick();
		return () => cancelAnimationFrame(frame);
	});

	const measure = $derived(
		piece ? Math.max(1, piece.measures.findLastIndex((t) => t <= now) + 1) : 1
	);
	const toMeasure = (m: number) => piece && synth?.seek(piece.measures[Math.max(0, m - 1)] ?? 0);
	const vocal = $derived(piece?.parts.filter((p) => p.vocal) ?? []);
	const time = (t: number) =>
		`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

	function keydown(e: KeyboardEvent) {
		if (e.key !== ' ' || (e.target as Element).closest('input, select, textarea, button')) return;
		e.preventDefault();
		if (synth?.playing) synth.pause();
		else synth?.play();
	}

	// The timeline: the vocal parts' notes and the focused (or first) part's CC2, around now.
	let canvas: HTMLCanvasElement;
	let width = $state(0);
	const WINDOW = 30,
		BEFORE = 6;
	$effect(() => {
		void width;
		const { ctx, w, h } = prepare(canvas);
		if (!synth || !piece) return;
		const start = Math.max(0, now - BEFORE),
			x = (t: number) => ((t - start) / WINDOW) * w;
		let lo = 127,
			hi = 0;
		for (const n of synth.notes) [lo, hi] = [Math.min(lo, n.key - 1), Math.max(hi, n.key + 1)];
		const y = (key: number) => h - 14 - ((key - lo) / (hi - lo)) * (h - 20);
		ctx.fillStyle = '#6a7080';
		piece.measures.forEach((t, i) => {
			if (t < start || t > start + WINDOW) return;
			ctx.fillStyle = '#2c303a';
			ctx.fillRect(x(t), 0, 1, h);
			ctx.fillStyle = '#6a7080';
			ctx.fillText(`${i + 1}`, x(t) + 2, h - 3);
		});
		if (looping) {
			const m = piece.measures;
			ctx.fillStyle = '#f0b42918';
			ctx.fillRect(x(m[loopFrom - 1] ?? 0), 0, x(m[loopTo] ?? 0) - x(m[loopFrom - 1] ?? 0), h);
		}
		vocal.forEach((p, i) => {
			const ch = p.channels[0];
			ctx.fillStyle = partColor(p.name, i) + (!focus || focus === p.name ? '' : '55');
			for (const n of synth!.notes)
				if (n.ch === ch && n.t1 > start && n.t0 < start + WINDOW)
					ctx.fillRect(x(n.t0), y(n.key) - 2, Math.max(1, x(n.t1) - x(n.t0) - 1), 4);
		});
		const shown = vocal.find((p) => p.name === focus) ?? vocal[0];
		const breath = shown && synth.breath.get(shown.channels[0]);
		if (breath) {
			ctx.strokeStyle = '#ffffffa0';
			ctx.beginPath();
			let last = breath.findLast(([t]) => t <= start)?.[1] ?? 0;
			ctx.moveTo(0, h - 14 - (last / 127) * (h - 20));
			for (const [t, v] of breath) {
				if (t <= start) continue;
				if (t > start + WINDOW) break;
				ctx.lineTo(x(t), h - 14 - (last / 127) * (h - 20));
				ctx.lineTo(x(t), h - 14 - (v / 127) * (h - 20));
				last = v;
			}
			ctx.lineTo(w, h - 14 - (last / 127) * (h - 20));
			ctx.stroke();
			ctx.fillStyle = '#ffffffa0';
			ctx.fillText(`CC2 of ${shown.name}: ${last}`, 4, 12);
		}
		ctx.fillStyle = '#f0b429';
		ctx.fillRect(x(now), 0, 2, h);
	});
	function seekAt(e: PointerEvent) {
		const r = canvas.getBoundingClientRect();
		synth?.seek(Math.max(0, now - BEFORE) + ((e.clientX - r.left) / r.width) * WINDOW);
	}
</script>

<svelte:window onkeydown={keydown} />

<div class="row">
	<select bind:value={choice}>
		{#each seasons as s (s.id)}
			<optgroup label={s.title}>
				{#each s.pieces as p (p.slug)}
					<option value="{s.id}/{p.slug}">{p.label}</option>
				{/each}
			</optgroup>
		{/each}
	</select>
	<button
		class="play"
		onclick={() => (synth?.playing ? synth.pause() : synth?.play())}
		disabled={!synth}
	>
		{synth?.playing ? (synth.waiting ? '…' : '❚❚') : '▶'}
	</button>
	<button onclick={() => toMeasure(measure - 1)} title="Previous measure">⏮</button>
	<button onclick={() => toMeasure(measure + 1)} title="Next measure">⏭</button>
	<input
		class="pos"
		type="range"
		min="0"
		max={synth?.duration ?? 1}
		step="0.1"
		value={now}
		oninput={(e) => synth?.seek(+e.currentTarget.value)}
	/>
	<span class="hint">{time(now)} · m. {measure}</span>
	<label title="Repeat these measures">
		<input type="checkbox" bind:checked={looping} /> Loop m.
		<input type="number" min="1" bind:value={loopFrom} />–<input
			type="number"
			min="1"
			bind:value={loopTo}
		/>
	</label>
	<select bind:value={speed} title="Speed">
		{#each [0.5, 0.75, 0.9, 1, 1.1, 1.25] as s (s)}<option value={s}>{s * 100}%</option>{/each}
	</select>
</div>
<div class="row">
	<label>
		Voices play
		<select bind:value={voice}>
			{#each INSTRUMENTS as [program, label] (program)}<option value={program}>{label}</option
				>{/each}
		</select>
	</label>
	<span class="parts">
		Focus
		<button class:on={!focus} onclick={() => (focus = '')}>All</button>
		{#each vocal as p, i (p.name)}
			<button
				class:on={focus === p.name}
				style="border-color: {partColor(p.name, i)}"
				onclick={() => (focus = focus === p.name ? '' : p.name)}>{p.name}</button
			>
		{/each}
	</span>
	<label title="The level of the other vocal parts while one has the focus">
		Others <input type="range" min="-40" max="0" bind:value={others} />
		{others} dB
	</label>
	<label title="The level of the accompaniment">
		Accompaniment <input type="range" min="0" max="1" step="0.05" bind:value={accompaniment} />
	</label>
	{#if error || synth?.error}<span class="error">{error || synth?.error}</span>{/if}
</div>
<canvas
	bind:this={canvas}
	bind:clientWidth={width}
	style="height: 120px; cursor: pointer"
	onpointerdown={seekAt}
></canvas>

<style>
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
		margin-bottom: 6px;
	}
	.play {
		width: 3em;
	}
	.pos {
		flex: 1;
		min-width: 120px;
	}
	.parts {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	input[type='number'] {
		width: 3.5em;
	}
	.error {
		color: #e8657a;
	}
</style>

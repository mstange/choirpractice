<script lang="ts">
	import type { DesignerSynth } from '../designer-synth.ts';
	import type { Patch } from '../patch.ts';
	import { Recorder } from '../recorder.ts';
	import type { SungReply, SungRequest } from '../sung-worker.ts';
	import { prepare } from './canvas.ts';

	let { patch, synth }: { patch: Patch; synth: DesignerSynth | null } = $props();

	/** The ranges to slide over, an octave each. */
	const RANGES: [string, number][] = [
		['A2–A3', 45],
		['D3–D4', 50],
		['A3–A4', 57]
	];
	/** Seconds of the starting tone, and of the slide up and back down. */
	const CUE = 3,
		SLIDE = 8;
	/** The fewest frames with a clear pitch that a fit is made from, and the most error trusted. */
	const MIN_FRAMES = 100,
		MAX_ERROR = 6;

	type Step = 'ah' | 'vowel';
	let low = $state(RANGES[0][1]),
		busy = $state<Step | null>(null),
		phase = $state<'cue' | 'record' | 'fit'>('cue'),
		error = $state(''),
		fits = $state<Partial<Record<Step, SungReply>>>({});
	/** The time since the cue started, and the pitch sung, for the plot. */
	let now = $state(-1),
		trace = $state.raw<[number, number][]>([]);

	/** The pitch to sing at `t` seconds from the start of the cue. */
	const target = (t: number) => {
		const s = Math.max(0, t - CUE);
		return low + 12 * (s < SLIDE / 2 ? s / (SLIDE / 2) : Math.max(0, 2 - s / (SLIDE / 2)));
	};

	const recorder = new Recorder();
	$effect(() => () => recorder.close());

	function fit(x: Float32Array, rate: number) {
		const worker = new Worker(new URL('../sung-worker.ts', import.meta.url), { type: 'module' });
		return new Promise<SungReply>((resolve) => {
			worker.onmessage = ({ data }: MessageEvent<SungReply>) => {
				worker.terminate();
				resolve(data);
			};
			worker.postMessage({ x, rate } satisfies SungRequest, [x.buffer]);
		});
	}

	async function sing(step: Step) {
		error = '';
		busy = step;
		synth?.pause();
		try {
			await recorder.open();
		} catch (e) {
			error = `No microphone: ${(e as Error).message}`;
			busy = null;
			return;
		}
		trace = [];
		const start = performance.now();
		let frame = 0;
		const follow = () => {
			now = (performance.now() - start) / 1000;
			const p = recorder.pitch();
			if (p !== null) trace = [...trace, [now, p]];
			frame = requestAnimationFrame(follow);
		};
		follow();
		phase = 'cue';
		await recorder.cue(low, CUE);
		phase = 'record';
		const x = await recorder.record(SLIDE);
		cancelAnimationFrame(frame);
		now = -1;
		phase = 'fit';
		const r = await fit(x, recorder.rate);
		busy = null;
		if (r.frames < MIN_FRAMES) {
			error = `Only ${r.frames} moments had a clear pitch. Sing louder or nearer the microphone, along the line, and try again.`;
			return;
		}
		fits[step] = r;
		if (step === 'vowel' && fits.ah) {
			const ah = fits.ah.formants;
			patch.vowel.sung = r.formants.map((f, i) => Math.round((f / ah[i]) * 100) / 100);
			patch.vowel.measured = [ah, r.formants];
			patch.vowel.vowel = 'sung';
		}
	}

	const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
	const noteName = (m: number) => {
		const key = Math.round(m);
		return `${NOTE_NAMES[key % 12]}${Math.floor(key / 12) - 1}`;
	};

	let canvas: HTMLCanvasElement;
	let width = $state(0);
	$effect(() => {
		void width;
		const { ctx, w, h } = prepare(canvas);
		const total = CUE + SLIDE,
			x = (t: number) => (t / total) * w,
			y = (m: number) => h - 6 - ((m - low + 2) / 16) * (h - 12);
		ctx.strokeStyle = '#2c303a';
		ctx.fillStyle = '#6a7080';
		for (const m of [low, low + 6, low + 12]) {
			ctx.beginPath();
			ctx.moveTo(0, y(m));
			ctx.lineTo(w, y(m));
			ctx.stroke();
			ctx.fillText(noteName(m), 2, y(m) - 2);
		}
		ctx.beginPath();
		ctx.moveTo(x(CUE), 0);
		ctx.lineTo(x(CUE), h);
		ctx.stroke();
		// The line to sing along, and what was sung.
		ctx.strokeStyle = '#f0b429';
		ctx.lineWidth = 3;
		ctx.beginPath();
		for (let px = 0; px <= w; px += 2) ctx.lineTo(px, y(target((px / w) * total)));
		ctx.stroke();
		ctx.lineWidth = 1;
		ctx.fillStyle = '#60d0e0';
		for (const [t, m] of trace) ctx.fillRect(x(t) - 1.5, y(m) - 1.5, 3, 3);
		if (now >= 0) {
			ctx.strokeStyle = '#fff';
			ctx.beginPath();
			ctx.moveTo(x(now), 0);
			ctx.lineTo(x(now), h);
			ctx.stroke();
		}
	});

	const describe = (r: SungReply) =>
		`F1 ${r.formants[0]}, F2 ${r.formants[1]}, F3 ${r.formants[2]} Hz, from ${noteName(r.low)} to ${noteName(r.high)}, ` +
		`${r.error.toFixed(1)} dB from the fit`;
</script>

<p class="hint">
	Sing a slide on "ah", then on the vowel you want, along the yellow line: hold the starting tone
	while it plays, then slide up and back down. Use headphones, or nothing else playing, and a range
	that is comfortable. The vowel's formants against your "ah" move the formants of a, in every
	register, and pick the vowel "sung".
</p>
<div class="row">
	Range
	{#each RANGES as [label, key] (key)}
		<button class:on={low === key} disabled={!!busy} onclick={() => (low = key)}>{label}</button>
	{/each}
</div>
<canvas bind:this={canvas} bind:clientWidth={width} style="height: 110px"></canvas>
<div class="row">
	<button disabled={!!busy} onclick={() => sing('ah')}>1. Sing “ah”</button>
	<button disabled={!!busy || !fits.ah} onclick={() => sing('vowel')}>2. Sing your vowel</button>
	{#if busy}
		<span class="hint"
			>{phase === 'cue'
				? `Starting tone: ${noteName(low)}…`
				: phase === 'record'
					? 'Slide up and back down'
					: 'Finding the formants…'}</span
		>
	{/if}
</div>
{#if error}<p class="warn">{error}</p>{/if}
{#each [['“ah”', fits.ah], ['Your vowel', fits.vowel]] as const as [label, r] (label)}
	{#if r}
		<p class="hint">
			{label}: {describe(r)}{#if r.error > MAX_ERROR}<span class="warn">
					— a poor fit: try again, more steadily</span
				>{/if}.
		</p>
	{/if}
{/each}
<p class="hint">
	The sung vowel moves a's formants by ×{patch.vowel.sung.join(
		', ×'
	)}{#if patch.vowel.measured.length}: F1 to F3 of “ah” {patch.vowel.measured[0].join(', ')} Hz, of the
		vowel {patch.vowel.measured[1].join(', ')} Hz{/if}.
</p>

<style>
	.row {
		display: flex;
		gap: 4px;
		align-items: center;
		margin: 4px 0;
	}
	.warn {
		color: #e8657a;
	}
</style>

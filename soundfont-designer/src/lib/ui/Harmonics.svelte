<script lang="ts">
	import { keyFreq } from '../dsp.ts';
	import { HARMONICS, type Patch } from '../patch.ts';
	import { lowpass, NYQUIST, toneEq } from '../spectrum.ts';
	import { prepare } from './canvas.ts';

	let { patch, previewKey }: { patch: Patch; previewKey: number } = $props();

	let canvas: HTMLCanvasElement;
	let width = $state(0);
	const TOP = 12,
		BOTTOM = -60,
		PAD = 18;

	/**
	 * Per harmonic of the preview key: its level in dB before the loudness is normalized, with the
	 * EQ, formants, contour and the filter at full dynamics, and that level without its own offset.
	 */
	const levels = $derived.by(() => {
		const f0 = keyFreq(previewKey),
			eq = toneEq(patch, previewKey),
			lp = lowpass(patch, f0),
			{ tilt, even, harmonics, maxHarmonic } = patch.tone;
		return Array.from({ length: HARMONICS }, (_, i) => {
			const f = (i + 1) * f0;
			const base = tilt * Math.log2(i + 1) + (i % 2 ? even : 0) + eq(f) + 20 * Math.log10(lp(f));
			return {
				base,
				db: base + harmonics[i],
				heard: i < maxHarmonic && f < NYQUIST * patch.output.sampleRate
			};
		});
	});

	const y = (db: number, h: number) => ((TOP - db) / (TOP - BOTTOM)) * (h - PAD);

	$effect(() => {
		void width;
		const { ctx, w, h } = prepare(canvas);
		const bw = w / HARMONICS;
		ctx.strokeStyle = '#2c303a';
		ctx.fillStyle = '#6a7080';
		for (let db = TOP; db >= BOTTOM; db -= 12) {
			ctx.beginPath();
			ctx.moveTo(0, y(db, h));
			ctx.lineTo(w, y(db, h));
			ctx.stroke();
			ctx.fillText(`${db}`, 2, y(db, h) - 2);
		}
		levels.forEach(({ base, db, heard }, i) => {
			const x = i * bw + 1,
				top = y(Math.max(db, BOTTOM), h);
			ctx.fillStyle = heard ? (patch.tone.harmonics[i] ? '#f0b429' : '#c99a2e') : '#3a3e48';
			ctx.fillRect(x, top, bw - 2, h - PAD - top);
			// Where the bar is without its offset.
			ctx.fillStyle = '#fff8';
			ctx.fillRect(x, y(base, h) - 1, bw - 2, 2);
			ctx.fillStyle = '#8a90a0';
			if (i < 9 || i % 4 === 3) ctx.fillText(`${i + 1}`, x + 1, h - 4);
		});
	});

	let drawing = false;
	function draw(e: PointerEvent) {
		const r = canvas.getBoundingClientRect();
		const i = Math.floor(((e.clientX - r.left) / r.width) * HARMONICS);
		if (i < 0 || i >= HARMONICS) return;
		const db = TOP - ((e.clientY - r.top) / (r.height - PAD)) * (TOP - BOTTOM);
		patch.tone.harmonics[i] = Math.round(Math.max(-60, Math.min(36, db - levels[i].base)));
	}
</script>

<canvas
	bind:this={canvas}
	bind:clientWidth={width}
	style="height: 150px; touch-action: none; cursor: crosshair"
	onpointerdown={(e) => {
		drawing = true;
		canvas.setPointerCapture(e.pointerId);
		draw(e);
	}}
	onpointermove={(e) => drawing && draw(e)}
	onpointerup={() => (drawing = false)}
></canvas>

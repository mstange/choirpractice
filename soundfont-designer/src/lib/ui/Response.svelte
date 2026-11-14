<script lang="ts">
	import { eqCurve, keyFreq } from '../dsp.ts';
	import type { Patch } from '../patch.ts';
	import { NYQUIST, noiseShape } from '../spectrum.ts';
	import { logX, prepare, xLog } from './canvas.ts';

	let { patch, previewKey }: { patch: Patch; previewKey: number } = $props();

	let canvas: HTMLCanvasElement;
	let width = $state(0);
	const LO = 40,
		HI = 16000,
		RANGE = 24;
	let active = $state(-1);

	const y = (db: number, h: number) => h / 2 - (db / RANGE) * (h / 2 - 6);

	$effect(() => {
		void width;
		const { ctx, w, h } = prepare(canvas);
		const x = (f: number) => logX(f, LO, HI, w);
		ctx.strokeStyle = '#2c303a';
		ctx.fillStyle = '#6a7080';
		for (const f of [100, 200, 500, 1000, 2000, 5000, 10000]) {
			ctx.beginPath();
			ctx.moveTo(x(f), 0);
			ctx.lineTo(x(f), h);
			ctx.stroke();
			ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x(f) + 2, h - 3);
		}
		for (const db of [-12, 0, 12]) {
			ctx.beginPath();
			ctx.moveTo(0, y(db, h));
			ctx.lineTo(w, y(db, h));
			ctx.stroke();
		}
		// The breath noise's band.
		const { noise, noiseLow, noiseHigh } = patch.tone;
		if (noise > -90) {
			ctx.fillStyle = '#5a9cf022';
			ctx.beginPath();
			ctx.moveTo(0, h);
			for (let px = 0; px <= w; px += 2)
				ctx.lineTo(px, h - noiseShape(xLog(px, LO, HI, w), noiseLow, noiseHigh) * h * 0.5);
			ctx.lineTo(w, h);
			ctx.fill();
		}
		// The harmonics of the preview key.
		const f0 = keyFreq(previewKey);
		ctx.strokeStyle = '#f0b42955';
		for (
			let k = 1;
			k <= patch.tone.maxHarmonic && k * f0 < Math.min(HI, NYQUIST * patch.output.sampleRate);
			k++
		) {
			ctx.beginPath();
			ctx.moveTo(x(k * f0), h);
			ctx.lineTo(x(k * f0), h - 10);
			ctx.stroke();
		}
		const eq = eqCurve(patch.eq);
		ctx.strokeStyle = '#5cc08a';
		ctx.lineWidth = 2;
		ctx.beginPath();
		for (let px = 0; px <= w; px += 2) ctx.lineTo(px, y(eq(xLog(px, LO, HI, w)), h));
		ctx.stroke();
		ctx.lineWidth = 1;
		patch.eq.forEach((b, i) => {
			ctx.fillStyle = i === active ? '#f0b429' : '#5cc08a';
			ctx.beginPath();
			ctx.arc(x(b.freq), y(b.gain, h), 6, 0, 2 * Math.PI);
			ctx.fill();
			ctx.fillStyle = '#000';
			ctx.fillText(`${i + 1}`, x(b.freq) - 3, y(b.gain, h) + 4);
		});
	});

	/** The band whose handle is nearest the pointer, within 16 px. */
	function nearest(e: PointerEvent | WheelEvent) {
		const r = canvas.getBoundingClientRect();
		let best = -1,
			dist = 16;
		patch.eq.forEach((b, i) => {
			const d = Math.hypot(
				logX(b.freq, LO, HI, r.width) - (e.clientX - r.left),
				y(b.gain, r.height) - (e.clientY - r.top)
			);
			if (d < dist) [best, dist] = [i, d];
		});
		return best;
	}

	function move(e: PointerEvent) {
		if (active < 0) return;
		const r = canvas.getBoundingClientRect(),
			b = patch.eq[active];
		b.freq = Math.round(xLog(Math.max(0, Math.min(r.width, e.clientX - r.left)), LO, HI, r.width));
		const db = ((r.height / 2 - (e.clientY - r.top)) / (r.height / 2 - 6)) * RANGE;
		b.gain = Math.round(Math.max(-RANGE, Math.min(RANGE, db)) * 2) / 2;
	}
</script>

<canvas
	bind:this={canvas}
	bind:clientWidth={width}
	style="height: 160px; touch-action: none"
	onpointerdown={(e) => {
		active = nearest(e);
		if (active >= 0) canvas.setPointerCapture(e.pointerId);
	}}
	onpointermove={move}
	onpointerup={() => (active = -1)}
	onwheel={(e) => {
		const i = nearest(e);
		if (i < 0) return;
		e.preventDefault();
		const b = patch.eq[i];
		b.q = Number(Math.max(0.1, Math.min(10, b.q * Math.exp(-e.deltaY / 300))).toPrecision(2));
	}}
></canvas>

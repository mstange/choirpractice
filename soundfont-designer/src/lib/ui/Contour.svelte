<script lang="ts">
	import { keyFreq } from '../dsp.ts';
	import { CONTOUR_FREQS, type Patch } from '../patch.ts';
	import { contourCurve, NYQUIST } from '../spectrum.ts';
	import { logX, prepare, xLog } from './canvas.ts';

	let { patch, previewKey }: { patch: Patch; previewKey: number } = $props();

	let canvas: HTMLCanvasElement;
	let width = $state(0);
	const LO = 40,
		HI = 16000,
		TOP = 12,
		BOTTOM = -60,
		PAD = 14;

	const y = (db: number, h: number) => ((TOP - db) / (TOP - BOTTOM)) * (h - PAD);

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
		for (let db = 0; db >= BOTTOM; db -= 12) {
			ctx.beginPath();
			ctx.moveTo(0, y(db, h));
			ctx.lineTo(w, y(db, h));
			ctx.stroke();
			ctx.fillText(`${db}`, 2, y(db, h) - 2);
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
			ctx.moveTo(x(k * f0), h - PAD);
			ctx.lineTo(x(k * f0), h - PAD - 10);
			ctx.stroke();
		}
		const gain = contourCurve(patch.contour);
		ctx.strokeStyle = '#60d0e0';
		ctx.lineWidth = 2;
		ctx.beginPath();
		for (let px = 0; px <= w; px += 2) ctx.lineTo(px, y(gain(xLog(px, LO, HI, w)), h));
		ctx.stroke();
		ctx.lineWidth = 1;
		ctx.fillStyle = '#60d0e0';
		for (const [j, f] of CONTOUR_FREQS.entries()) {
			ctx.beginPath();
			ctx.arc(x(f), y(patch.contour[j], h), 3, 0, 2 * Math.PI);
			ctx.fill();
		}
	});

	/** The point drawn last and its value, so that a fast stroke sets the points between too. */
	let last = -1,
		lastValue = 0;
	function draw(e: PointerEvent) {
		const r = canvas.getBoundingClientRect();
		const f = xLog(e.clientX - r.left, LO, HI, r.width),
			j = Math.max(0, Math.min(CONTOUR_FREQS.length - 1, Math.round(3 * Math.log2(f / 50))));
		const db = TOP - ((e.clientY - r.top) / (r.height - PAD)) * (TOP - BOTTOM),
			v = Math.round(Math.max(BOTTOM, Math.min(TOP, db)) * 2) / 2;
		if (last < 0) [last, lastValue] = [j, v];
		for (let k = Math.min(last, j); k <= Math.max(last, j); k++) {
			const t = j === last ? 1 : (k - last) / (j - last);
			patch.contour[k] = Math.round((lastValue + t * (v - lastValue)) * 2) / 2;
		}
		[last, lastValue] = [j, v];
	}
</script>

<canvas
	bind:this={canvas}
	bind:clientWidth={width}
	style="height: 150px; touch-action: none; cursor: crosshair"
	onpointerdown={(e) => {
		last = -1;
		canvas.setPointerCapture(e.pointerId);
		draw(e);
	}}
	onpointermove={(e) => last >= 0 && draw(e)}
	onpointerup={() => (last = -1)}
></canvas>

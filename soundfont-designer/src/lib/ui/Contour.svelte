<script lang="ts">
	import { keyFreq } from '../dsp.ts';
	import { CONTOUR_FREQS, CONTOUR_KEYS, type Patch } from '../patch.ts';
	import { contourCurve, NYQUIST } from '../spectrum.ts';
	import { vowelCurve } from '../vowel.ts';
	import { logX, prepare, xLog } from './canvas.ts';

	let {
		patch,
		previewKey,
		register = 0
	}: { patch: Patch; previewKey: number; register?: number } = $props();

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
		const curve = (gain: (f: number) => number, style: string, lw: number, dash: number[] = []) => {
			ctx.strokeStyle = style;
			ctx.lineWidth = lw;
			ctx.setLineDash(dash);
			ctx.beginPath();
			for (let px = 0; px <= w; px += 2) ctx.lineTo(px, y(gain(xLog(px, LO, HI, w)), h));
			ctx.stroke();
			ctx.setLineDash([]);
			ctx.lineWidth = 1;
		};
		// The preview key's vowel and contour together, with its highest point at 0 dB.
		const vowel = vowelCurve(patch.vowel, previewKey),
			contour = contourCurve(patch.contour, previewKey),
			both = (f: number) => vowel(f) + contour(f),
			top = Math.max(
				...Array.from({ length: 200 }, (_, i) => both(xLog(i * (w / 199), LO, HI, w)))
			);
		curve((f) => both(f) - top, '#b88cf0', 1.5);
		// The other registers dim, the preview key's contour between them dashed, and the one that
		// is drawn on with its points.
		CONTOUR_KEYS.forEach((key, g) => {
			if (g !== register) curve(contourCurve(patch.contour, key), '#60d0e055', 1.5);
		});
		curve(contourCurve(patch.contour, previewKey), '#fff8', 1, [4, 3]);
		curve(contourCurve(patch.contour, CONTOUR_KEYS[register]), '#60d0e0', 2);
		ctx.fillStyle = '#60d0e0';
		for (const [j, f] of CONTOUR_FREQS.entries()) {
			ctx.beginPath();
			ctx.arc(x(f), y(patch.contour[register][j], h), 3, 0, 2 * Math.PI);
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
			patch.contour[register][k] = Math.round((lastValue + t * (v - lastValue)) * 2) / 2;
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

<script lang="ts">
	import type { Built } from '../build-worker.ts';
	import { prepare } from './canvas.ts';

	let { built }: { built: Built | null } = $props();

	let levels: HTMLCanvasElement, wave: HTMLCanvasElement;
	let width = $state(0);
	const COLORS = ['#5a9cf0', '#5cc08a', '#e8657a', '#f0b429'];

	$effect(() => {
		void width;
		const { ctx, w, h } = prepare(levels);
		if (!built) return;
		const { step, off, curves } = built.preview;
		const max = Math.max(...curves.flatMap((c) => [...c.db]));
		const top = Math.ceil(max / 6) * 6 + 3,
			bottom = top - 60;
		const end = curves[0].db.length * step;
		const x = (t: number) => (t / end) * w,
			y = (db: number) => ((top - db) / (top - bottom)) * h;
		ctx.strokeStyle = '#2c303a';
		ctx.fillStyle = '#6a7080';
		for (let db = top - 3; db > bottom; db -= 12) {
			ctx.beginPath();
			ctx.moveTo(0, y(db));
			ctx.lineTo(w, y(db));
			ctx.stroke();
			ctx.fillText(`${db} dB`, 2, y(db) - 2);
		}
		for (let t = 0.5; t < end; t += 0.5) ctx.fillText(`${t}s`, x(t) + 2, h - 3);
		ctx.strokeStyle = '#8a90a0';
		ctx.setLineDash([3, 3]);
		ctx.beginPath();
		ctx.moveTo(x(off), 0);
		ctx.lineTo(x(off), h);
		ctx.stroke();
		ctx.setLineDash([]);
		curves.forEach((c, i) => {
			ctx.strokeStyle = COLORS[i];
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			c.db.forEach((db, j) => ctx.lineTo(x(j * step), y(Math.max(db, bottom))));
			ctx.stroke();
			ctx.fillStyle = COLORS[i];
			ctx.fillText(c.label, w - 150 + i * 36, 12);
		});
		ctx.lineWidth = 1;
	});

	$effect(() => {
		void width;
		const { ctx, w, h } = prepare(wave);
		if (!built) return;
		const data = built.wave;
		let peak = 0;
		for (const v of data) peak = Math.max(peak, Math.abs(v));
		ctx.strokeStyle = '#2c303a';
		ctx.beginPath();
		ctx.moveTo(0, h / 2);
		ctx.lineTo(w, h / 2);
		ctx.stroke();
		ctx.strokeStyle = '#f0b429';
		ctx.beginPath();
		for (let px = 0; px < w; px++)
			ctx.lineTo(px, h / 2 - (data[Math.floor((px / w) * data.length)] / peak) * (h / 2 - 2));
		ctx.stroke();
		ctx.fillStyle = '#6a7080';
		ctx.fillText(`${((data.length / built.waveRate) * 1000).toFixed(0)} ms of the tone`, 4, 12);
	});
</script>

<canvas bind:this={levels} bind:clientWidth={width} style="height: 170px"></canvas>
<canvas bind:this={wave} style="height: 60px; margin-top: 6px"></canvas>

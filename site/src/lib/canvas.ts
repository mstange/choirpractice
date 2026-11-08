import type { Sheet } from './sheet.ts';
import type { PieceData } from './types.ts';

export const NOW_X = 0.2; // position of the "now" line as a fraction of the bar view width
export const LOOP_RGB = '255 204 0';

/** Measures to repeat: from measure `from` up to measure `to`, exclusive. Counted from 0. */
export interface Loop {
	from: number;
	to: number;
	on: boolean;
}

const drawnKeys = new WeakMap<HTMLCanvasElement, string>();

/**
 * Whether `c` already shows what `key` describes, at its current size. If not, `key` becomes what
 * it shows, so the caller has to draw it. Skipping unchanged frames saves the canvas's present,
 * which is expensive on some platforms.
 */
export function unchanged(c: HTMLCanvasElement, key: string) {
	const full = `${c.clientWidth}x${c.clientHeight}@${devicePixelRatio} ${key}`;
	if (drawnKeys.get(c) === full) return true;
	drawnKeys.set(c, full);
	return false;
}

/**
 * Gives back the memory of `c` and of what is cached for it, and has it drawn again from scratch.
 */
export function freeCanvas(c: HTMLCanvasElement) {
	[c.width, c.height] = [0, 0];
	drawnKeys.delete(c);
	timelineCache.get(c)?.base.close();
	timelineCache.delete(c);
}

/** Sizes the canvas backing store to its CSS size and returns a context in CSS pixels. */
export function prepare(c: HTMLCanvasElement) {
	const dpr = devicePixelRatio,
		W = c.clientWidth,
		H = c.clientHeight,
		// Rounded: the backing store has whole pixels, and a fractional devicePixelRatio (common on
		// Android) would otherwise resize, and so reset, the canvas on every frame.
		w = Math.round(W * dpr),
		h = Math.round(H * dpr);
	if (c.width !== w || c.height !== h) [c.width, c.height] = [w, h];
	const g = c.getContext('2d')!;
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	g.clearRect(0, 0, W, H);
	return { g, W, H };
}

export function drawSheet(
	c: HTMLCanvasElement,
	sheet: Sheet,
	t: number,
	color: string,
	frozen: boolean
) {
	const key = sheet.update(t, c.clientWidth, c.clientHeight, frozen);
	if (unchanged(c, `${sheet.info.file} ${color} ${key}`)) return;
	const { g, W, H } = prepare(c);
	if (key === null) return;
	g.globalAlpha = 0.85;
	sheet.draw(g, W, H, color);
	g.globalAlpha = 1;
}

// The overview is static apart from the playhead and the loop, so it is drawn once per size, into
// an ImageBitmap (see Sheet's tiles).
const timelineCache = new WeakMap<HTMLCanvasElement, { key: string; base: ImageBitmap }>();

export function drawTimeline(
	c: HTMLCanvasElement,
	data: PieceData,
	colors: Record<string, string>,
	t: number,
	loop: [number, number] | null
) {
	const duration = data.measures[data.measures.length - 1];
	const dpr = devicePixelRatio;
	// The playhead in device pixels: it moves less than one in most frames.
	const playhead = Math.round((t / duration) * c.clientWidth * dpr);
	if (unchanged(c, `${playhead} ${loop}`)) return;
	const { g, W, H } = prepare(c);
	const key = `${W}x${H}@${dpr}`;
	let cached = timelineCache.get(c);
	if (cached?.key !== key) {
		const base = new OffscreenCanvas(c.width, c.height);
		const b = base.getContext('2d')!;
		b.scale(dpr, dpr);
		const x = (s: number) => (s / duration) * W;
		const laneH = H / (data.voices.length + 1);
		b.fillStyle = 'rgb(255 255 255 / 0.08)';
		data.measures.forEach((m, i) => {
			if (i % 4 === 0) b.fillRect(x(m), 0, 1, H);
		});
		data.voices.forEach((v, vi) => {
			b.fillStyle = colors[v.name];
			for (const s of v.syllables)
				b.fillRect(x(s.t0), laneH * (vi + 0.5), Math.max(0.5, x(s.t1) - x(s.t0) - 1), laneH * 0.7);
		});
		cached?.base.close();
		cached = { key, base: base.transferToImageBitmap() };
		timelineCache.set(c, cached);
	}
	g.drawImage(cached.base, 0, 0, W, H);
	if (loop) {
		const [x0, x1] = loop.map((s) => (s / duration) * W);
		g.fillStyle = `rgb(${LOOP_RGB} / 0.12)`;
		g.fillRect(x0, 0, x1 - x0, H);
		g.fillStyle = `rgb(${LOOP_RGB})`;
		g.fillRect(x0, 0, x1 - x0, 3);
	}
	g.fillStyle = 'white';
	g.fillRect(playhead / dpr - 1, 0, 2, H);
}

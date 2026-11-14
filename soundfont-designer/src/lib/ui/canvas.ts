/**
 * Sizes a canvas's buffer to its CSS size in device pixels and clears it; returns its context,
 * which draws in CSS pixels, and the size.
 */
export function prepare(canvas: HTMLCanvasElement) {
	const dpr = devicePixelRatio,
		w = canvas.clientWidth,
		h = canvas.clientHeight;
	if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
	if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
	const ctx = canvas.getContext('2d')!;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, w, h);
	ctx.font = '11px system-ui, sans-serif';
	return { ctx, w, h };
}

/** The x of frequency `f` on a log axis from `lo` to `hi` over width `w`, and its inverse. */
export const logX = (f: number, lo: number, hi: number, w: number) =>
	(Math.log(f / lo) / Math.log(hi / lo)) * w;
export const xLog = (x: number, lo: number, hi: number, w: number) => lo * (hi / lo) ** (x / w);

/** The colors of the parts, by voice type, as in the choir app. */
export function partColor(name: string, i: number) {
	const n = name.toLowerCase();
	if (n.startsWith('s')) return '#e8657a';
	if (n.startsWith('a')) return '#f0a43a';
	if (n.startsWith('t')) return '#5cc08a';
	if (n.startsWith('b')) return '#5a9cf0';
	return ['#b88cf0', '#e0d060', '#60d0e0', '#e080c0'][i % 4];
}

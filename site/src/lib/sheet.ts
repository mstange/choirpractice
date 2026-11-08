import type { Engraving } from './types.ts';

const TILE = 1024; // tile width in device pixels
const PAGE = 0.6; // page advance, as a fraction of the strip width
const LEAD = 0.2; // how far into the strip the cursor sits after turning a page
const TURN = 0.07; // time constant of the page turn animation, in seconds

/**
 * One engraved line of sheet music (see tools/engrave.py), drawn white on transparent in pages.
 *
 * The sheet stands still while a cursor moves along it. When the cursor passes LEAD + PAGE of the
 * width, the sheet slides on by PAGE, so that some of the music before and after is always
 * visible. Engraved notes aren't spaced in proportion to time, so a continuously scrolling sheet
 * would keep changing speed.
 *
 * The SVG is loaded on first use and rasterized in tiles at the current scale. Only the tiles in
 * view are kept: the whole line at screen resolution would take about 100 MB.
 */
export class Sheet {
	readonly info: Engraving;

	#url: string;
	#img: HTMLImageElement | undefined;
	#ready = false;
	#scale = 0;
	#cssScale = 1;
	#tiles = new Map<number, ImageBitmap>();
	/** The engraving x at the strip's left edge, in CSS pixels, as currently drawn. */
	#shown = 0;
	#drawnAt = 0;
	/** The strip's left edge and the cursor, in CSS pixels, as of the last `update`. */
	#left = 0;
	#cursor = 0;

	constructor(info: Engraving, url: string) {
		this.info = info;
		this.#url = url;
	}

	/** The x position in the engraving that belongs to time `s`, between the segments' positions. */
	xAt(s: number): number {
		const { t, x } = this.info;
		let lo = 0,
			hi = t.length - 1;
		if (s <= t[lo]) return x[lo];
		if (s >= t[hi]) return x[hi];
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (t[mid] <= s) lo = mid;
			else hi = mid;
		}
		return x[lo] + ((s - t[lo]) / (t[hi] - t[lo])) * (x[hi] - x[lo]);
	}

	/** The time at CSS x position `px` of the strip, as last drawn. */
	timeAt(px: number): number {
		const { t, x } = this.info;
		const u = (this.#shown + px) / this.#cssScale;
		let k = 0;
		while (k < x.length - 2 && x[k + 1] <= u) k++;
		return Math.max(0, t[k] + ((u - x[k]) / (x[k + 1] - x[k])) * (t[k + 1] - t[k]));
	}

	/**
	 * Moves the page on for time `s` in a strip of W x H CSS pixels, scaled to fit the height. A
	 * `frozen` page stays where it is, for dragging the cursor along it. Returns a key of what `draw`
	 * would show, or null until the SVG has loaded.
	 */
	update(s: number, W: number, H: number, frozen: boolean): string | null {
		if (!this.#img) {
			// Fetched like piece.json, which places the music on it: an <img> could come from the
			// browser's image cache, which Firefox reuses within a tab even for no-store responses, and so
			// be an earlier build than piece.json.
			const img = (this.#img = new Image());
			fetch(this.#url)
				.then((res) => {
					if (!res.ok) throw new Error(`${this.#url}: HTTP ${res.status}`);
					return res.blob();
				})
				.then((blob) => {
					img.src = URL.createObjectURL(blob);
					return img.decode();
				})
				.then(() => {
					URL.revokeObjectURL(img.src);
					this.#ready = true;
				});
		}
		if (!this.#ready) return null;
		const dpr = devicePixelRatio,
			scale = H / this.info.height,
			ds = scale * dpr;
		if (ds !== this.#scale) {
			for (const tile of this.#tiles.values()) tile.close();
			[this.#scale, this.#cssScale, this.#tiles] = [ds, scale, new Map()];
		}

		this.#cursor = this.xAt(s) * scale;
		const page = Math.max(0, Math.floor((this.#cursor - LEAD * W) / (PAGE * W)));
		const target = frozen
			? this.#shown
			: Math.max(0, Math.min(page * PAGE * W, this.info.width * scale - W));
		const now = performance.now() / 1000;
		// Slide to the next page; jump after seeking, and when the slide is within half a device pixel,
		// so that it ends.
		if (Math.abs(target - this.#shown) > W || Math.abs(target - this.#shown) < 0.5 / dpr)
			this.#shown = target;
		else this.#shown += (target - this.#shown) * (1 - Math.exp(-(now - this.#drawnAt) / TURN));
		this.#drawnAt = now;
		// Snap to device pixels, so that the tiles are drawn without resampling.
		this.#left = -Math.round(this.#shown * dpr) / dpr;
		return `${ds} ${this.#left} ${this.#cursor}`;
	}

	/** Draws the page as of the last `update`, which must have returned a key. */
	draw(g: CanvasRenderingContext2D, W: number, H: number, color: string) {
		const dpr = devicePixelRatio,
			ds = this.#scale,
			left = this.#left;
		const k0 = Math.max(0, Math.floor((-left * dpr) / TILE)),
			k1 = Math.min(Math.ceil((this.info.width * ds) / TILE), Math.ceil(((W - left) * dpr) / TILE));
		for (const [k, tile] of this.#tiles)
			if (k < k0 || k >= k1) {
				tile.close();
				this.#tiles.delete(k);
			}
		for (let k = k0; k < k1; k++) {
			const tile = this.#tile(k);
			g.drawImage(tile, left + (k * TILE) / dpr, 0, tile.width / dpr, tile.height / dpr);
		}
		g.fillStyle = color;
		g.fillRect(left + this.#cursor - 1, 0, 2, H);
	}

	// An ImageBitmap rather than the OffscreenCanvas itself: Firefox's remote canvas sends a canvas
	// source's pixels to the GPU process on every drawImage, but an ImageBitmap's only once.
	#tile(k: number): ImageBitmap {
		let tile = this.#tiles.get(k);
		if (!tile) {
			const ds = this.#scale,
				units = TILE / ds;
			const c = new OffscreenCanvas(TILE, Math.ceil(this.info.height * ds));
			const g = c.getContext('2d')!;
			g.drawImage(
				this.#img!,
				k * units,
				0,
				units,
				this.info.height,
				0,
				0,
				TILE,
				this.info.height * ds
			);
			g.globalCompositeOperation = 'source-in';
			g.fillStyle = '#fff';
			g.fillRect(0, 0, c.width, c.height);
			tile = c.transferToImageBitmap();
			this.#tiles.set(k, tile);
		}
		return tile;
	}
}

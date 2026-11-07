import { LOOP_RGB, NOW_X, prepare, unchanged, type Loop } from './canvas.ts';
import type { Note, PieceData, Voice } from './types.ts';

const TILE = 1024; // tile width in device pixels
const SETTLE = 100; // ms that the scale must stay the same before tiles are drawn at it
const TEXT_MARGIN = 300; // CSS pixels by which a lyric can reach past its note's start
const EDGE = 10; // CSS pixels by which a bar can reach before its note's start

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let lyricFont: string | undefined;

/**
 * The microphone's pitch: past points (NaN where unpitched) and the current pitch, and how much
 * earlier than recorded to draw them.
 */
export interface MicTrace {
	trail: { t: number; p: number }[];
	now: number | null;
	shift: number;
}

const pitchRanges = new WeakMap<Note[], [number, number]>();
function pitchRange(notes: Note[]): [number, number] {
	let range = pitchRanges.get(notes);
	if (!range) {
		range = [Infinity, -Infinity];
		for (const n of notes) range = [Math.min(range[0], n.p), Math.max(range[1], n.p)];
		pitchRanges.set(notes, range);
	}
	return range;
}

/** Vertical layout of the bar view: one pitch axis shared by all voices. */
function pitchAxis(voices: Voice[], H: number) {
	const ranges = voices.map((v) => pitchRange(v.notes));
	const lo = Math.min(...ranges.map((r) => r[0])),
		hi = Math.max(...ranges.map((r) => r[1]));
	const top = 38,
		bottom = H - 34;
	const step = (bottom - top) / (hi - lo + 2);
	return { lo: lo - 1, hi: hi + 1, step, y: (p: number) => bottom - (p - lo + 1) * step };
}

interface VoiceLayout {
	v: Voice;
	barH: number;
	grow: number;
	outline: boolean;
	alpha: number;
	lyrics: boolean;
	z: number;
}

// Voices often sing in unison: selected voices are filled bars on top, and the others are slightly
// larger outlines, so they stay visible around them. Selected voices that coincide simply cover
// each other.
function barLayout(voices: Voice[], selected: Set<string>, step: number): VoiceLayout[] {
	const barH = Math.min(18, step * 0.8);
	return voices.map((v, i) => {
		const dom = selected.has(v.name);
		const grow = dom ? 0 : 6;
		return {
			v,
			barH: barH + grow,
			grow,
			outline: !dom,
			alpha: dom ? 1 : 0.8,
			lyrics: dom,
			z: dom ? 1 + i : 0
		};
	});
}

/** Everything about the view that doesn't depend on time. */
interface Layout {
	H: number;
	axis: ReturnType<typeof pitchAxis>;
	/** In drawing order: the selected voices last, so that they sit on top. */
	voices: VoiceLayout[];
	font: number;
}

function layout(data: PieceData, selected: Set<string>, H: number): Layout {
	const axis = pitchAxis(data.voices, H);
	const voices = barLayout(data.voices, selected, axis.step).sort((a, b) => a.z - b.z);
	return { H, axis, voices, font: selected.size > 1 ? 14 : 20 };
}

function roundRect(g: Context2D, x: number, y: number, w: number, h: number, outline = false) {
	g.beginPath();
	g.roundRect(x, y, Math.max(w, h), h, h / 2);
	if (outline) g.stroke();
	else g.fill();
}

const noteX = (V: VoiceLayout, n: Note, X: (s: number) => number) =>
	[X(n.t0) - V.grow / 2, X(n.t1) - 3 + V.grow / 2] as const;

/** The pitch grid: one faint line per semitone, labelled at every C. It doesn't scroll. */
function drawGrid(g: CanvasRenderingContext2D, L: Layout, W: number) {
	for (let p = L.axis.lo; p <= L.axis.hi; p++) {
		const gy = Math.round(L.axis.y(p)) + 0.5;
		g.fillStyle = p % 12 === 0 ? 'rgb(255 255 255 / 0.13)' : 'rgb(255 255 255 / 0.035)';
		g.fillRect(0, gy, W, 1);
		if (p % 12 === 0) {
			g.fillStyle = 'rgb(255 255 255 / 0.35)';
			g.font = '11px system-ui, sans-serif';
			g.fillText(`C${p / 12 - 1}`, W - 26, gy - 3);
		}
	}
}

/**
 * The measure lines, bars and lyrics between times `s0` and `s1`, with `X` mapping time to x. With
 * `past`, they are drawn as they look once the "now" line has passed them.
 */
function drawMusic(
	g: Context2D,
	data: PieceData,
	colors: Record<string, string>,
	L: Layout,
	X: (s: number) => number,
	s0: number,
	s1: number,
	past: boolean
) {
	lyricFont ??= getComputedStyle(document.documentElement).getPropertyValue('--lyric-font');
	const y = L.axis.y;
	g.fillStyle = 'rgb(255 255 255 / 0.07)';
	for (const m of data.measures) if (m >= s0 && m <= s1) g.fillRect(X(m), 0, 1, L.H);

	for (const V of L.voices) {
		const color = colors[V.v.name],
			notes = V.v.notes,
			h = V.barH;
		g.fillStyle = g.strokeStyle = color;
		g.lineWidth = 2;
		notes.forEach((n, i) => {
			if (n.t1 < s0 || n.t0 > s1) return;
			const [x0, x1] = noteX(V, n, X),
				top = y(n.p) - h / 2;
			// Connect notes of a melisma, each to the closest pitch of the notes that follow it,
			// since a chord's notes come one after the other.
			let next: Note | undefined;
			for (let j = i + 1; j < notes.length && notes[j].t0 < n.t1 + 0.01; j++) {
				const m = notes[j];
				if (m.s === n.s && Math.abs(m.t0 - n.t1) < 0.01)
					if (!next || Math.abs(m.p - n.p) < Math.abs(next.p - n.p)) next = m;
			}
			if (!V.outline && next && next.p !== n.p) {
				g.globalAlpha = V.alpha * 0.5;
				g.beginPath();
				g.moveTo(x1 - h / 2, y(n.p));
				g.lineTo(X(next.t0) - V.grow / 2 + h / 2, y(next.p));
				g.stroke();
			}
			g.globalAlpha = V.alpha * (V.outline ? 0.45 : 0.28);
			roundRect(g, x0, top, x1 - x0, h, V.outline);
			if (past) {
				g.globalAlpha = V.alpha;
				if (V.outline) {
					roundRect(g, x0, top, x1 - x0, h, true);
					g.globalAlpha = 0.15;
				}
				roundRect(g, x0, top, x1 - x0, h);
			}
		});
		if (V.lyrics) {
			g.font = `500 ${L.font}px ${lyricFont}`;
			const firstNote = new Map<number, Note>();
			for (const n of notes) if (!firstNote.has(n.s)) firstNote.set(n.s, n);
			V.v.syllables.forEach((s, i) => {
				if (s.t0 < s0 || s.t0 > s1) return;
				const x = X(s.t0),
					ly = y(firstNote.get(i)!.p) + h / 2 + L.font + 2;
				const text = s.text + (s.syl === 'b' || s.syl === 'm' ? '-' : '');
				g.globalAlpha = V.alpha * 0.45;
				g.fillStyle = '#fff';
				g.fillText(text, x, ly);
				if (past) {
					g.globalAlpha = V.alpha;
					g.fillStyle = color;
					g.fillText(text, x, ly);
				}
			});
		}
		g.globalAlpha = 1;
	}
}

/** What moves with time: the glow of the sounding notes, the pitch markers, the mic and the "now" line. */
function drawNow(
	g: CanvasRenderingContext2D,
	colors: Record<string, string>,
	L: Layout,
	X: (s: number) => number,
	t: number,
	nowX: number,
	mic: MicTrace | null
) {
	const y = L.axis.y;
	for (const V of L.voices) {
		const color = colors[V.v.name],
			h = V.barH;
		g.save();
		g.fillStyle = g.strokeStyle = color;
		g.lineWidth = 2;
		g.globalAlpha = V.alpha;
		if (!V.outline) {
			// The part of a sounding note that the "now" line has passed glows.
			g.save();
			g.beginPath();
			g.rect(0, 0, nowX, L.H);
			g.clip();
			[g.shadowColor, g.shadowBlur] = [color, 18];
			for (const n of V.v.notes) {
				if (n.t0 > t) break;
				if (t >= n.t1) continue;
				const [x0, x1] = noteX(V, n, X);
				roundRect(g, x0, y(n.p) - h / 2, x1 - x0, h);
			}
			g.restore();
		}
		// Pitch marker on the "now" line.
		const active = V.v.notes.find((n) => n.t0 <= t && t < n.t1);
		if (active) {
			[g.shadowColor, g.shadowBlur] = [color, 14];
			g.beginPath();
			g.arc(nowX, y(active.p), h * 0.55, 0, 2 * Math.PI);
			if (V.outline) g.stroke();
			else g.fill();
		}
		g.restore();
	}
	if (mic) drawMic(g, mic, y, (s) => X(s - mic.shift), nowX);
	g.fillStyle = 'rgb(255 255 255 / 0.55)';
	g.fillRect(nowX - 1, 0, 2, L.H);
}

function drawMic(
	g: CanvasRenderingContext2D,
	mic: MicTrace,
	y: (p: number) => number,
	X: (s: number) => number,
	nowX: number
) {
	g.save();
	g.strokeStyle = g.fillStyle = '#fff';
	[g.shadowColor, g.shadowBlur] = ['#fff', 8];
	g.lineWidth = 3;
	[g.lineCap, g.lineJoin] = ['round', 'round'];
	g.beginPath();
	// Break the line at unpitched points, gaps and jumps, so that only continuous singing connects.
	let prev: { t: number; p: number } | undefined;
	for (let i = mic.trail.length - 1; i >= 0; i--) {
		const pt = mic.trail[i];
		if (Number.isNaN(pt.p)) prev = undefined;
		else {
			const joined = prev && prev.t - pt.t < 0.1 && Math.abs(prev.p - pt.p) < 2;
			if (joined) g.lineTo(X(pt.t), y(pt.p));
			else g.moveTo(X(pt.t), y(pt.p));
			prev = pt;
		}
		if (X(pt.t) < 0) break;
	}
	g.stroke();
	if (mic.now !== null) {
		g.beginPath();
		g.arc(nowX, y(mic.now), 6, 0, 2 * Math.PI);
		g.fill();
	}
	g.restore();
}

/** The ruler at the top of the view: measure numbers and the loop, `H` high. */
function drawRuler(
	g: CanvasRenderingContext2D,
	measures: number[],
	X: (s: number) => number,
	W: number,
	H: number,
	nowX: number,
	loop: Loop | null
) {
	g.fillStyle = 'rgb(255 255 255 / 0.05)';
	g.fillRect(0, 0, W, H);
	if (loop) {
		const x0 = X(measures[loop.from]);
		g.fillStyle = loop.on ? `rgb(${LOOP_RGB})` : 'rgb(255 255 255 / 0.22)';
		g.beginPath();
		g.roundRect(x0, 3, X(measures[loop.to]) - x0, H - 6, 4);
		g.fill();
	}
	g.font = '12px system-ui, sans-serif';
	g.textBaseline = 'middle';
	for (let i = 0; i < measures.length - 1; i++) {
		const x = X(measures[i]);
		if (x < -40 || x > W) continue;
		const looped = loop?.on && loop.from <= i && i < loop.to;
		g.fillStyle = looped ? 'rgb(0 0 0 / 0.65)' : 'rgb(255 255 255 / 0.4)';
		g.fillText(String(i + 1), x + 5, H / 2);
	}
	g.textBaseline = 'alphabetic';
	g.fillStyle = 'rgb(255 255 255 / 0.55)';
	g.fillRect(nowX - 1, 0, 2, H);
}

function canvasIn(parent: HTMLElement) {
	const c = document.createElement('canvas');
	c.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none';
	parent.append(c);
	return c;
}

/**
 * The Pitch view: bars of each voice's notes on a shared pitch axis, scrolling past a "now" line.
 *
 * The music doesn't change as it scrolls, so it is drawn once, into ImageBitmap tiles of TILE
 * device pixels, in two versions: as it looks before the "now" line reaches it, and after. Each
 * frame draws the tiles at device pixel positions, on each side of the line the version for that
 * side, and then what changes with time. Only canvases change from frame to frame, which Firefox
 * paints without building a display list, and the tiles' pixels go to the GPU once. The pitch grid,
 * which doesn't scroll, has a canvas of its own below. The ruler is drawn on top, `rulerH` high, so
 * that it needs no canvas of its own.
 *
 * Tiles hold one scale. While the scale changes, for zooming or resizing, the view is drawn
 * without them, and they are drawn once it has settled for SETTLE ms.
 */
export class BarsView {
	#el: HTMLElement;
	#data: PieceData;
	#colors: Record<string, string>;
	#grid: HTMLCanvasElement;
	#canvas: HTMLCanvasElement;
	/** The tiles before and after the "now" line, by index. */
	#tiles = { future: new Map<number, ImageBitmap>(), past: new Map<number, ImageBitmap>() };
	#scratch: OffscreenCanvas | undefined;
	/** The key of the scale and layout, the time it took that value, and the tiles' key. */
	#key = '';
	#keySince = 0;
	#tileKey = '';

	constructor(el: HTMLElement, data: PieceData, colors: Record<string, string>) {
		[this.#el, this.#data, this.#colors] = [el, data, colors];
		this.#grid = canvasIn(el);
		this.#canvas = canvasIn(el);
	}

	draw(
		t: number,
		seconds: number,
		selected: Set<string>,
		mic: MicTrace | null,
		loop: Loop | null,
		rulerH: number
	) {
		const W = this.#el.clientWidth,
			H = this.#el.clientHeight,
			dpr = devicePixelRatio;
		const pps = W / seconds,
			nowX = W * NOW_X;
		// Snapped to device pixels, so that the tiles are drawn without resampling.
		const offset = Math.round((nowX - t * pps) * dpr) / dpr;
		const X = (s: number) => offset + s * pps;
		const L = layout(this.#data, selected, H);

		if (!unchanged(this.#grid, '')) drawGrid(prepare(this.#grid).g, L, W);

		const key = `${pps} ${H} ${dpr} ${[...selected]} ${document.fonts.status}`;
		const now = performance.now();
		if (key !== this.#key) [this.#key, this.#keySince] = [key, now];
		if (key !== this.#tileKey)
			for (const tiles of Object.values(this.#tiles)) {
				for (const tile of tiles.values()) tile.close();
				tiles.clear();
			}
		const tiled = key === this.#tileKey || now - this.#keySince >= SETTLE;
		// The tiles that each side shows: device pixels k * TILE to (k + 1) * TILE of the music.
		const sides = [
			{ past: false, a: nowX, b: W },
			{ past: true, a: 0, b: nowX }
		].map((side) => ({
			...side,
			k0: Math.floor(((side.a - offset) * dpr) / TILE),
			k1: Math.ceil(((side.b - offset) * dpr) / TILE)
		}));
		if (tiled) {
			this.#tileKey = key;
			let ahead = 1; // tiles drawn ahead of need per frame
			for (const { past, k0, k1 } of sides) {
				const tiles = past ? this.#tiles.past : this.#tiles.future;
				for (const [k, tile] of tiles)
					if (k < k0 - 1 || k > k1) {
						tile.close();
						tiles.delete(k);
					}
				for (let k = k0; k < k1; k++) if (!tiles.has(k)) this.#tile(tiles, k, past, L, pps);
				if (!tiles.has(k1) && ahead-- > 0) this.#tile(tiles, k1, past, L, pps);
			}
		}

		const last = mic?.trail[mic.trail.length - 1];
		const micKey = mic ? `${mic.trail.length},${last?.t},${mic.now},${mic.shift}` : '';
		const loopKey = loop ? `${loop.from}-${loop.to}${loop.on ? '' : 'off'}` : '';
		if (unchanged(this.#canvas, `${tiled} ${key} ${offset} ${t} ${micKey} ${loopKey} ${rulerH}`))
			return;
		const { g } = prepare(this.#canvas);
		if (loop?.on) {
			const x0 = X(this.#data.measures[loop.from]),
				x1 = X(this.#data.measures[loop.to]);
			g.fillStyle = `rgb(${LOOP_RGB} / 0.05)`;
			g.fillRect(x0, 0, x1 - x0, H);
			g.fillStyle = `rgb(${LOOP_RGB} / 0.4)`;
			g.fillRect(x0, 0, 1, H);
			g.fillRect(x1 - 1, 0, 1, H);
		}
		for (const { past, a, b, k0, k1 } of sides) {
			g.save();
			g.beginPath();
			g.rect(a, 0, b - a, H);
			g.clip();
			if (tiled) {
				const tiles = past ? this.#tiles.past : this.#tiles.future;
				for (let k = k0; k < k1; k++) {
					const tile = tiles.get(k)!;
					g.drawImage(tile, offset + (k * TILE) / dpr, 0, TILE / dpr, tile.height / dpr);
				}
			} else
				drawMusic(
					g,
					this.#data,
					this.#colors,
					L,
					X,
					(a - TEXT_MARGIN - offset) / pps,
					(b + EDGE - offset) / pps,
					past
				);
			g.restore();
		}
		drawNow(g, this.#colors, L, X, t, nowX, mic);
		drawRuler(g, this.#data.measures, X, W, rulerH, nowX, loop);
	}

	/** Draws tile `k`, which covers device pixels k * TILE to (k + 1) * TILE of the music. */
	#tile(tiles: Map<number, ImageBitmap>, k: number, past: boolean, L: Layout, pps: number) {
		const dpr = devicePixelRatio,
			x0 = (k * TILE) / dpr,
			h = Math.round(L.H * dpr);
		const c = (this.#scratch ??= new OffscreenCanvas(TILE, h));
		if (c.height !== h) c.height = h;
		const g = c.getContext('2d')!;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		const s0 = (x0 - TEXT_MARGIN) / pps,
			s1 = (x0 + TILE / dpr + EDGE) / pps;
		drawMusic(g, this.#data, this.#colors, L, (s) => s * pps - x0, s0, s1, past);
		tiles.set(k, c.transferToImageBitmap());
	}
}

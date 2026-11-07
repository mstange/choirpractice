import { LOOP_RGB, NOW_X, prepare, unchanged, type Loop } from './canvas.ts';
import type { Note, PieceData, Voice } from './types.ts';

const TILE = 1024; // tile width in device pixels
const SETTLE = 100; // ms that the scale must stay the same before tiles are drawn at it
const TEXT_MARGIN = 300; // CSS pixels by which a lyric can reach past its note's start
const EDGE = 10; // CSS pixels by which a bar can reach before its note's start

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

function roundRect(
	g: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	outline = false
) {
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
	g: CanvasRenderingContext2D,
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

function layer(parent: HTMLElement, tag = 'div') {
	const el = document.createElement(tag);
	el.style.cssText = 'position: absolute; top: 0; left: 0; pointer-events: none';
	parent.append(el);
	return el;
}

/** A clipped part of the view, past or future of the "now" line, that holds tiles of the music. */
interface Side {
	past: boolean;
	clip: HTMLElement;
	scroller: HTMLElement;
	tiles: Map<number, HTMLCanvasElement>;
}

/**
 * The Pitch view: bars of each voice's notes on a shared pitch axis, scrolling past a "now" line.
 *
 * The music doesn't change as it scrolls, so it is drawn once, in tiles of TILE device pixels, in
 * two versions: as it looks before the "now" line reaches it, and after. The tiles are canvases in
 * two clipped layers, one on each side of the line, which the compositor moves; only what changes
 * with time is drawn on every frame, into a canvas on top. The pitch grid, which doesn't scroll,
 * has a canvas of its own, and the loop is an element below.
 *
 * Tiles hold one scale. While the scale changes, for zooming or resizing, the top canvas draws
 * everything instead, and the tiles are drawn once it has settled for SETTLE ms.
 */
export class BarsView {
	#el: HTMLElement;
	#data: PieceData;
	#colors: Record<string, string>;
	#loopScroller: HTMLElement;
	#loop: HTMLElement;
	#grid: HTMLCanvasElement;
	#sides: Side[];
	#overlay: HTMLCanvasElement;
	#pool: HTMLCanvasElement[] = [];
	/** The key of the scale and layout, the time it took that value, and the tiles' key. */
	#key = '';
	#keySince = 0;
	#tileKey = '';

	constructor(el: HTMLElement, data: PieceData, colors: Record<string, string>) {
		[this.#el, this.#data, this.#colors] = [el, data, colors];
		this.#loopScroller = layer(el);
		this.#loop = layer(this.#loopScroller);
		Object.assign(this.#loop.style, {
			height: '100%',
			boxSizing: 'border-box',
			background: `rgb(${LOOP_RGB} / 0.05)`,
			borderInline: `1px solid rgb(${LOOP_RGB} / 0.4)`
		});
		this.#loopScroller.style.height = '100%';
		this.#grid = layer(el, 'canvas') as HTMLCanvasElement;
		this.#sides = [false, true].map((past) => {
			const clip = layer(el);
			Object.assign(clip.style, { height: '100%', overflow: 'hidden' });
			return { past, clip, scroller: layer(clip), tiles: new Map() };
		});
		this.#overlay = layer(el, 'canvas') as HTMLCanvasElement;
		for (const c of [this.#grid, this.#overlay])
			Object.assign(c.style, { width: '100%', height: '100%' });
	}

	draw(t: number, seconds: number, selected: Set<string>, mic: MicTrace | null, loop: Loop | null) {
		const W = this.#el.clientWidth,
			H = this.#el.clientHeight,
			dpr = devicePixelRatio;
		const pps = W / seconds,
			nowX = W * NOW_X;
		// Snapped to device pixels, so that the tiles are composited without resampling.
		const offset = Math.round((nowX - t * pps) * dpr) / dpr;
		const X = (s: number) => offset + s * pps;
		const L = layout(this.#data, selected, H);

		if (!unchanged(this.#grid, '')) drawGrid(prepare(this.#grid).g, L, W);

		this.#loopScroller.style.transform = `translateX(${offset}px)`;
		this.#loop.style.display = loop?.on ? '' : 'none';
		if (loop?.on) {
			const [m0, m1] = [this.#data.measures[loop.from], this.#data.measures[loop.to]];
			Object.assign(this.#loop.style, { left: `${m0 * pps}px`, width: `${(m1 - m0) * pps}px` });
		}

		const key = `${pps} ${H} ${dpr} ${[...selected]} ${document.fonts.status}`;
		const now = performance.now();
		if (key !== this.#key) [this.#key, this.#keySince] = [key, now];
		if (key !== this.#tileKey)
			for (const side of this.#sides) {
				for (const tile of side.tiles.values()) {
					tile.remove();
					this.#pool.push(tile);
				}
				side.tiles.clear();
			}
		const tiled = key === this.#tileKey || now - this.#keySince >= SETTLE;
		if (tiled) {
			this.#tileKey = key;
			let ahead = 1; // tiles drawn ahead of need per frame
			for (const side of this.#sides) {
				const [a, b] = side.past ? [0, nowX] : [nowX, W];
				const k0 = Math.floor(((a - offset) * dpr) / TILE),
					k1 = Math.ceil(((b - offset) * dpr) / TILE);
				for (const [k, tile] of side.tiles)
					if (k < k0 - 1 || k > k1) {
						tile.remove();
						this.#pool.push(tile);
						side.tiles.delete(k);
					}
				for (let k = k0; k < k1; k++) if (!side.tiles.has(k)) this.#tile(side, k, L, pps);
				if (!side.tiles.has(k1) && ahead-- > 0) this.#tile(side, k1, L, pps);
				Object.assign(side.clip.style, { left: `${a}px`, width: `${b - a}px` });
				side.scroller.style.transform = `translateX(${offset - a}px)`;
			}
		}
		for (const side of this.#sides) side.clip.style.display = tiled ? '' : 'none';

		const last = mic?.trail[mic.trail.length - 1];
		const micKey = mic ? `${mic.trail.length},${last?.t},${mic.now},${mic.shift}` : '';
		if (unchanged(this.#overlay, `${tiled} ${key} ${offset} ${t} ${micKey}`)) return;
		const { g } = prepare(this.#overlay);
		if (!tiled) {
			const s0 = (-TEXT_MARGIN - offset) / pps,
				s1 = (W + EDGE - offset) / pps;
			for (const past of [false, true]) {
				g.save();
				g.beginPath();
				if (past) g.rect(0, 0, nowX, H);
				else g.rect(nowX, 0, W - nowX, H);
				g.clip();
				drawMusic(g, this.#data, this.#colors, L, X, s0, s1, past);
				g.restore();
			}
		}
		drawNow(g, this.#colors, L, X, t, nowX, mic);
	}

	/** Draws tile `k` of `side`, which covers device pixels k * TILE to (k + 1) * TILE of the music. */
	#tile(side: Side, k: number, L: Layout, pps: number) {
		const dpr = devicePixelRatio,
			x0 = (k * TILE) / dpr,
			w = TILE / dpr;
		const c = this.#pool.pop() ?? (layer(side.scroller, 'canvas') as HTMLCanvasElement);
		side.scroller.append(c);
		const h = Math.round(L.H * dpr);
		if (c.width !== TILE || c.height !== h) [c.width, c.height] = [TILE, h];
		Object.assign(c.style, {
			width: `${w}px`,
			height: `${L.H}px`,
			transform: `translateX(${x0}px)`
		});
		const g = c.getContext('2d')!;
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.clearRect(0, 0, c.width, c.height);
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		const s0 = (x0 - TEXT_MARGIN) / pps,
			s1 = (x0 + w + EDGE) / pps;
		drawMusic(g, this.#data, this.#colors, L, (s) => s * pps - x0, s0, s1, side.past);
		side.tiles.set(k, c);
	}
}

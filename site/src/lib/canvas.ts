import type { Sheet } from './sheet.ts';
import type { Note, PieceData, Voice } from './types.ts';

export const NOW_X = 0.2; // position of the "now" line as a fraction of the bar view width
const LOOP_RGB = '255 204 0';

/** Measures to repeat: from measure `from` up to measure `to`, exclusive. Counted from 0. */
export interface Loop {
	from: number;
	to: number;
	on: boolean;
}

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

/** Sizes the canvas backing store to its CSS size and returns a context in CSS pixels. */
function prepare(c: HTMLCanvasElement) {
	const dpr = devicePixelRatio,
		W = c.clientWidth,
		H = c.clientHeight;
	if (c.width !== W * dpr || c.height !== H * dpr) [c.width, c.height] = [W * dpr, H * dpr];
	const g = c.getContext('2d')!;
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	g.clearRect(0, 0, W, H);
	return { g, W, H };
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

/**
 * Horizontal layout of the bar view and its ruler, with time `t` on the "now" line and `seconds`
 * of music across the width.
 */
function timeAxis(W: number, t: number, seconds: number) {
	const nowX = W * NOW_X,
		pps = W / seconds;
	return {
		nowX,
		X: (s: number) => nowX + (s - t) * pps,
		tMin: t - nowX / pps,
		tMax: t + (W - nowX) / pps
	};
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

export function drawBars(
	c: HTMLCanvasElement,
	data: PieceData,
	colors: Record<string, string>,
	t: number,
	seconds: number,
	selected: Set<string>,
	mic: MicTrace | null,
	loop: Loop | null
) {
	lyricFont ??= getComputedStyle(document.documentElement).getPropertyValue('--lyric-font');
	const { g, W, H } = prepare(c);
	const { nowX, X, tMin, tMax } = timeAxis(W, t, seconds);
	const axis = pitchAxis(data.voices, H),
		y = axis.y;
	const layout = barLayout(data.voices, selected, axis.step);
	const font = selected.size > 1 ? 14 : 20;

	if (loop?.on) {
		const x0 = X(data.measures[loop.from]),
			x1 = X(data.measures[loop.to]);
		g.fillStyle = `rgb(${LOOP_RGB} / 0.05)`;
		g.fillRect(x0, 0, x1 - x0, H);
		g.fillStyle = `rgb(${LOOP_RGB} / 0.4)`;
		g.fillRect(x0, 0, 1, H);
		g.fillRect(x1 - 1, 0, 1, H);
	}

	g.fillStyle = 'rgb(255 255 255 / 0.07)';
	for (const m of data.measures) {
		const x = X(m);
		if (x >= 0 && x <= W) g.fillRect(x, 0, 1, H);
	}

	// Pitch grid: one faint line per semitone, labelled at every C.
	for (let p = axis.lo; p <= axis.hi; p++) {
		const gy = Math.round(y(p)) + 0.5;
		g.fillStyle = p % 12 === 0 ? 'rgb(255 255 255 / 0.13)' : 'rgb(255 255 255 / 0.035)';
		g.fillRect(0, gy, W, 1);
		if (p % 12 === 0) {
			g.fillStyle = 'rgb(255 255 255 / 0.35)';
			g.font = '11px system-ui, sans-serif';
			g.fillText(`C${p / 12 - 1}`, W - 26, gy - 3);
		}
	}

	// Draw the selected voices last so that they sit on top.
	const order = [...layout].sort((a, b) => a.z - b.z);
	const pastClip = () => {
		g.beginPath();
		g.rect(0, 0, nowX, H);
		g.clip();
	};
	for (const L of order) {
		const color = colors[L.v.name],
			notes = L.v.notes,
			h = L.barH,
			grow = L.grow;
		g.fillStyle = g.strokeStyle = color;
		g.lineWidth = 2;
		notes.forEach((n, i) => {
			if (n.t1 < tMin || n.t0 > tMax) return;
			const x0 = X(n.t0) - grow / 2,
				x1 = X(n.t1) - 3 + grow / 2,
				top = y(n.p) - h / 2;
			// Connect notes of a melisma, each to the closest pitch of the notes that follow it,
			// since a chord's notes come one after the other.
			let next: Note | undefined;
			for (let j = i + 1; j < notes.length && notes[j].t0 < n.t1 + 0.01; j++) {
				const m = notes[j];
				if (m.s === n.s && Math.abs(m.t0 - n.t1) < 0.01)
					if (!next || Math.abs(m.p - n.p) < Math.abs(next.p - n.p)) next = m;
			}
			if (!L.outline && next && next.p !== n.p) {
				g.globalAlpha = L.alpha * 0.5;
				g.beginPath();
				g.moveTo(x1 - h / 2, y(n.p));
				g.lineTo(X(next.t0) - grow / 2 + h / 2, y(next.p));
				g.stroke();
			}
			g.globalAlpha = L.alpha * (L.outline ? 0.45 : 0.28);
			roundRect(g, x0, top, x1 - x0, h, L.outline);
			if (x0 < nowX) {
				g.save();
				pastClip();
				g.globalAlpha = L.alpha;
				if (L.outline) {
					roundRect(g, x0, top, x1 - x0, h, true);
					g.globalAlpha = 0.15;
				} else if (n.t0 <= t && t < n.t1) {
					[g.shadowColor, g.shadowBlur] = [color, 18];
				}
				roundRect(g, x0, top, x1 - x0, h);
				g.restore();
			}
		});
		if (L.lyrics) {
			g.font = `500 ${font}px ${lyricFont}`;
			const firstNote = new Map<number, Note>();
			for (const n of notes) if (!firstNote.has(n.s)) firstNote.set(n.s, n);
			L.v.syllables.forEach((s, i) => {
				if (s.t1 < tMin - 2 || s.t0 > tMax) return;
				const x = X(s.t0),
					ly = y(firstNote.get(i)!.p) + h / 2 + font + 2;
				const text = s.text + (s.syl === 'b' || s.syl === 'm' ? '-' : '');
				g.globalAlpha = L.alpha * 0.45;
				g.fillStyle = '#fff';
				g.fillText(text, x, ly);
				if (x < nowX) {
					g.save();
					pastClip();
					g.globalAlpha = L.alpha;
					g.fillStyle = color;
					g.fillText(text, x, ly);
					g.restore();
				}
			});
		}
		// Pitch marker on the "now" line.
		const active = notes.find((n) => n.t0 <= t && t < n.t1);
		if (active) {
			g.save();
			g.fillStyle = g.strokeStyle = color;
			g.globalAlpha = L.alpha;
			[g.shadowColor, g.shadowBlur] = [color, 14];
			g.beginPath();
			g.arc(nowX, y(active.p), h * 0.55, 0, 2 * Math.PI);
			if (L.outline) g.stroke();
			else g.fill();
			g.restore();
		}
		g.globalAlpha = 1;
	}

	if (mic) drawMic(g, mic, y, (s) => X(s - mic.shift), tMin + mic.shift, nowX);

	g.fillStyle = 'rgb(255 255 255 / 0.55)';
	g.fillRect(nowX - 1, 0, 2, H);
}

/** The ruler above the bar view: measure numbers and the loop. */
export function drawRuler(
	c: HTMLCanvasElement,
	measures: number[],
	t: number,
	seconds: number,
	loop: Loop | null
) {
	const { g, W, H } = prepare(c);
	const { nowX, X } = timeAxis(W, t, seconds);
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
	g.fillStyle = 'rgb(255 255 255 / 0.55)';
	g.fillRect(nowX - 1, 0, 2, H);
}

function drawMic(
	g: CanvasRenderingContext2D,
	mic: MicTrace,
	y: (p: number) => number,
	X: (s: number) => number,
	tMin: number,
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
		if (pt.t < tMin) break;
	}
	g.stroke();
	if (mic.now !== null) {
		g.beginPath();
		g.arc(nowX, y(mic.now), 6, 0, 2 * Math.PI);
		g.fill();
	}
	g.restore();
}

export function drawSheet(
	c: HTMLCanvasElement,
	sheet: Sheet,
	t: number,
	color: string,
	frozen: boolean
) {
	const { g, W, H } = prepare(c);
	g.globalAlpha = 0.85;
	sheet.draw(g, t, W, H, color, frozen);
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
	const { g, W, H } = prepare(c);
	const duration = data.measures[data.measures.length - 1];
	const dpr = devicePixelRatio;
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
	g.fillRect((t / duration) * W - 1, 0, 2, H);
}

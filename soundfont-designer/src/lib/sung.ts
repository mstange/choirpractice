// A sung vowel's formants, from a recording sung over a range of pitches: per frame its pitch and the level of each
// harmonic, and the formants of a cascade of resonators that fit those levels best, with a gain of
// its own for each frame and a tilt for the voice and the microphone.
import { detectPitch } from '../../../site/src/lib/pitch.ts';
import { cascade, vowelTable } from './vowel.ts';

/** Seconds per frame, and of the window that each frame's pitch and harmonics come from. */
const HOP = 0.02,
	WINDOW = 0.0427;
/**
 * The highest harmonic measured, in Hz. Above it are the higher formants, which the fit doesn't
 * place, and a laptop's microphone and the room take over: with harmonics up to 4.5 kHz, F3 of
 * Chimera's vowels came out anywhere up to 4 kHz.
 */
const TOP = 3500;

/** A frame of a recording: its time in seconds, pitch, harmonics' frequencies and levels, and level. */
export type Frame = { t: number; midi: number; freq: number[]; db: number[]; rms: number };

let win = new Float64Array(0),
	windowed = new Float64Array(0);

/**
 * The harmonics of `frame`, at the pitch `midi`, that stand above the noise halfway to their
 * neighbours, up to `TOP`: their frequencies and levels in dB.
 */
export function harmonics(frame: Float32Array, rate: number, midi: number) {
	const n = frame.length;
	if (win.length !== n) {
		win = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
		windowed = new Float64Array(n);
	}
	for (let i = 0; i < n; i++) windowed[i] = win[i] * frame[i];
	/** The amplitude of the windowed frame at `f` Hz, by Goertzel's recurrence. */
	const at = (f: number) => {
		const c = 2 * Math.cos((2 * Math.PI * f) / rate);
		let s1 = 0,
			s2 = 0;
		for (let i = 0; i < n; i++) [s1, s2] = [windowed[i] + c * s1 - s2, s1];
		return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2));
	};
	const f0 = 440 * 2 ** ((midi - 69) / 12),
		freq: number[] = [],
		db: number[] = [];
	for (let k = 1; k * f0 < TOP; k++) {
		const a = at(k * f0),
			noise = Math.max(at((k - 0.5) * f0), at((k + 0.5) * f0));
		if (a > 2 * noise) {
			freq.push(k * f0);
			db.push(20 * Math.log10(a));
		}
	}
	return { freq, db };
}

/** Seconds per frame. */
export const FRAME = HOP;

/**
 * The frame of `x` from sample `start`, at `t` seconds, if it has a clear pitch and at least
 * three harmonics, with its level in dB.
 */
export function frameAt(x: Float32Array, rate: number, start: number, t: number): Frame | null {
	const frame = x.subarray(start, start + Math.round(WINDOW * rate)),
		midi = detectPitch(frame, rate);
	if (midi === null) return null;
	const { freq, db } = harmonics(frame, rate, midi);
	let rms = 0;
	for (const v of frame) rms += v * v;
	return freq.length >= 3 ? { t, midi, freq, db, rms: 10 * Math.log10(rms / frame.length) } : null;
}

/** The samples from one frame's start to the next's, and that a frame spans, at `rate`. */
export const frameSamples = (rate: number) => ({
	hop: Math.round(HOP * rate),
	window: Math.round(WINDOW * rate)
});

/** The frames within 20 dB of the loudest. */
export function loud(frames: Frame[]) {
	const loudest = Math.max(...frames.map((f) => f.rms));
	return frames.filter((f) => f.rms > loudest - 20);
}

/** The pitched frames of `x` within 20 dB of the loudest. */
export function analyse(x: Float32Array, rate: number): Frame[] {
	const { hop, window } = frameSamples(rate),
		frames: Frame[] = [];
	for (let start = 0; start + window <= x.length; start += hop) {
		const f = frameAt(x, rate, start, start / rate);
		if (f) frames.push(f);
	}
	return loud(frames);
}

/** The formants' bandwidths in Hz, as in Csound's table for a tenor's a. */
const BANDWIDTHS = [80, 90, 120, 130, 140];

/** F1 to F5 from F1 to F3: F4 and F5 above F3, and at least where a man's are. */
const five = ([f1, f2, f3]: number[]) => [
	f1,
	f2,
	f3,
	Math.max(f3 * 1.15, 3500),
	Math.max(f3 * 1.3, 4200)
];

/**
 * How far the levels of `frames` are from those of formants F1 to F3, in dB rms, with the best
 * gain for each frame and the best slope for the voice and the microphone: a tilt per octave of
 * frequency, and a curvature, since a real voice through a laptop's microphone rises against a
 * straight tilt at both ends (by 10 dB around 200 Hz in the user's "ah"). With a straight tilt,
 * the user's "ah" sung over half its range fitted F1 at 200–260 Hz instead of 625.
 */
export function misfit(frames: Frame[], formants: number[]) {
	const d = deviations(frames, formants),
		[a, b] = tilt(d);
	let sum = 0,
		count = 0;
	d.rs.forEach((r, j) =>
		r.forEach((v, i) => {
			sum += (v - a * d.xs[j][i][0] - b * d.xs[j][i][1]) ** 2;
			count++;
		})
	);
	return Math.sqrt(sum / count);
}

/**
 * Per frame of `frames`, how far its levels are from formants F1 to F3, in dB rms, with its best
 * gain and the slope that fits `by` best.
 */
export function frameErrors(frames: Frame[], formants: number[], by = frames) {
	const [a, b] = tilt(deviations(by, formants)),
		{ rs, xs } = deviations(frames, formants);
	return rs.map((r, j) =>
		Math.sqrt(r.reduce((s, v, i) => s + (v - a * xs[j][i][0] - b * xs[j][i][1]) ** 2, 0) / r.length)
	);
}

/**
 * The levels of `frames` against formants F1 to F3, for a least squares fit of
 * r = gain(frame) + a·x + b·x², with x the octaves of the frequency: the deviations of r, x and x²
 * from their frame's means, and their sums of products, from which a and b follow.
 */
function deviations(frames: Frame[], formants: number[]) {
	const fr = { freq: five(formants), bw: BANDWIDTHS };
	const rs: number[][] = [],
		xs: [number, number][][] = [];
	let s11 = 0,
		s12 = 0,
		s22 = 0,
		s1r = 0,
		s2r = 0;
	for (const { freq, db } of frames) {
		const r = db.map((d, i) => d - 20 * Math.log10(cascade(fr, freq[i]))),
			x = freq.map((f) => Math.log2(f / 1000));
		const mean = (v: number[]) => v.reduce((s, e) => s + e, 0) / v.length,
			mr = mean(r),
			m1 = mean(x),
			m2 = mean(x.map((v) => v * v));
		const dr = r.map((v) => v - mr),
			dx = x.map((v): [number, number] => [v - m1, v * v - m2]);
		dx.forEach(([a, b], i) => {
			s11 += a * a;
			s12 += a * b;
			s22 += b * b;
			s1r += a * dr[i];
			s2r += b * dr[i];
		});
		rs.push(dr);
		xs.push(dx);
	}
	return { rs, xs, s11, s12, s22, s1r, s2r };
}

/** The tilt a and curvature b that fit `deviations()` best. */
function tilt({ s11, s12, s22, s1r, s2r }: ReturnType<typeof deviations>) {
	const det = s11 * s22 - s12 * s12;
	return det > 1e-9 ? [(s22 * s1r - s12 * s2r) / det, (s11 * s2r - s12 * s1r) / det] : [0, 0];
}

const valid = ([f1, f2, f3]: number[]) => f1 > 180 && f2 > f1 * 1.25 && f3 > f2 * 1.1 && f3 < 4000;

/**
 * The formants F1 to F3 that fit the levels of `frames` best, and how far the levels are from
 * them in dB rms: from each vowel of Csound's table and from `from`, the formants that a search
 * moving one formant at a time by ever smaller ratios finds, the best of those. The search from
 * each start uses at most `SEARCHED` of the frames, evenly spread, and only the best result goes
 * on with all of them, so that a fit takes about as long however long the recording is.
 */
export function fitFormants(frames: Frame[], from?: number[]) {
	const step = Math.max(1, frames.length / SEARCHED),
		some =
			frames.length > SEARCHED
				? Array.from({ length: SEARCHED }, (_, i) => frames[Math.floor(i * step)])
				: frames;
	let best = { formants: [0, 0, 0], error: Infinity };
	for (const start of from ? [...vowelTable(), from] : vowelTable()) {
		const found = search(some, start.slice(0, 3));
		if (found.error < best.error) best = found;
	}
	if (some !== frames) best = search(frames, best.formants);
	return { formants: best.formants.map(Math.round), error: best.error };
}
const SEARCHED = 100;

function search(frames: Frame[], formants: number[]) {
	let error = misfit(frames, formants);
	for (const step of [1.12, 1.06, 1.03, 1.015, 1.0075]) {
		for (let improved = true; improved;) {
			improved = false;
			for (let i = 0; i < 3; i++)
				for (const r of [step, 1 / step]) {
					const tried = formants.with(i, formants[i] * r);
					if (!valid(tried)) continue;
					const e = misfit(frames, tried);
					if (e < error) [formants, error, improved] = [tried, e, true];
				}
		}
	}
	return { formants, error };
}

/**
 * The fit needs the harmonics to sample the spectrum densely: frequency bands of an eighth of an
 * octave from `LOWEST` Hz up to the highest harmonic measured, each with harmonics in it for
 * `NEED` seconds. A held note fills the bands wider than its pitch, above about 1 kHz; the
 * narrower bands below fill as the pitch moves, by a few semitones near F1. The bands below the
 * lowest pitch sung can't fill, and aren't needed.
 */
export const LOWEST = 250,
	BANDS = 30,
	NEED = 0.2;
export const bandOf = (f: number) => Math.floor(8 * Math.log2(f / LOWEST)),
	bandFreq = (i: number) => LOWEST * 2 ** (i / 8);
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** The seconds of harmonics per band in `frames`, the first band needed, and whether all are full. */
export function coverage(frames: Frame[]) {
	const covered: number[] = Array(BANDS).fill(0);
	let low = Infinity;
	for (const f of frames) {
		low = Math.min(low, hz(f.midi));
		for (const b of new Set(f.freq.map(bandOf))) if (b >= 0 && b < BANDS) covered[b] += FRAME;
	}
	const first = frames.length ? Math.max(0, Math.ceil(8 * Math.log2(low / LOWEST))) : 0;
	return {
		covered,
		first,
		full: frames.length > 0 && covered.every((c, i) => i < first || c >= NEED)
	};
}

/**
 * The stretches of a recording that are judged apart, in seconds, and how much further from the
 * fit than the median stretch one may be before it counts as off the vowel.
 */
export const STRETCH = 0.5;
const STRAY = 3;

/**
 * The formants of a sung vowel, leaving out the stretches that strayed from it, and the same of
 * the first time through the frequency bands and the rest, to tell whether the vowel stayed the
 * same: the stretches whose frames are more than `STRAY` dB rms further from the fit than the
 * median stretch's are left out, and the fit made again without them, from where it was, until
 * that leaves out the same stretches. The first time through ends once the frames kept have filled every band
 * needed; the second once the frames after it have too. With `from`, the fit starts from those
 * formants only, instead of from every vowel of Csound's table.
 */
export function assess(all: Frame[], from?: number[]) {
	const frames = loud(all),
		stretch = (f: Frame) => Math.floor(f.t / STRETCH);
	let stray = new Set<number>(),
		kept = frames,
		fit = fitFormants(kept, from);
	for (let i = 0; i < 4; i++) {
		const errors = frameErrors(frames, fit.formants, kept),
			sums = new Map<number, [number, number]>();
		frames.forEach((f, j) => {
			const s = sums.get(stretch(f)) ?? [0, 0];
			sums.set(stretch(f), [s[0] + errors[j] ** 2, s[1] + 1]);
		});
		const rms = new Map([...sums].map(([k, [e, n]]) => [k, Math.sqrt(e / n)])),
			sorted = [...rms.values()].sort((a, b) => a - b),
			median = sorted[sorted.length >> 1],
			next = new Set([...rms].filter(([, e]) => e > median + STRAY).map(([k]) => k));
		if ([...next].join() === [...stray].join()) break;
		stray = next;
		kept = frames.filter((f) => !stray.has(stretch(f)));
		const found = search(kept, fit.formants);
		fit = { formants: found.formants.map(Math.round), error: found.error };
	}
	// The first time through: the frames kept up to the one that fills the last band needed.
	let end = -1;
	const covered: number[] = Array(BANDS).fill(0);
	for (let j = 0, low = Infinity; j < kept.length && end < 0; j++) {
		low = Math.min(low, hz(kept[j].midi));
		for (const b of new Set(kept[j].freq.map(bandOf))) if (b >= 0 && b < BANDS) covered[b] += FRAME;
		const first = Math.max(0, Math.ceil(8 * Math.log2(low / LOWEST)));
		if (covered.every((c, i) => i < first || c >= NEED)) end = j + 1;
	}
	const again = end < 0 ? kept : kept.slice(end),
		now = coverage(again),
		twice = end >= 0 && now.full;
	return {
		...fit,
		frames: kept.length,
		/** The start of each stretch left out, in seconds. */
		stray: [...stray].map((k) => k * STRETCH).sort((a, b) => a - b),
		/** The time through the bands that is being sung: 1, 2, or 3 once both are full. */
		time: twice ? 3 : end < 0 ? 1 : 2,
		/** The coverage of that time through. */
		coverage: now,
		/** The formants of the first and the second time through, once both are full. */
		times: twice
			? [kept.slice(0, end), again].map((f) => fitFormants(f, fit.formants).formants)
			: null,
		low: Math.min(...kept.map((f) => f.midi)),
		high: Math.max(...kept.map((f) => f.midi))
	};
}

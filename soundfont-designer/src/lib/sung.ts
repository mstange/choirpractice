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

export type Frame = { midi: number; freq: number[]; db: number[] };

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

/**
 * The pitched frames of `x`: their pitch and their harmonics, in the frames within 20 dB of the
 * loudest that have at least three.
 */
export function analyse(x: Float32Array, rate: number): Frame[] {
	const n = Math.round(WINDOW * rate),
		hop = Math.round(HOP * rate);
	const frames: (Frame & { rms: number })[] = [];
	for (let start = 0; start + n <= x.length; start += hop) {
		const frame = x.subarray(start, start + n),
			midi = detectPitch(frame, rate);
		if (midi === null) continue;
		const { freq, db } = harmonics(frame, rate, midi);
		let rms = 0;
		for (const v of frame) rms += v * v;
		if (freq.length >= 3) frames.push({ midi, freq, db, rms: 10 * Math.log10(rms / n) });
	}
	const loudest = Math.max(...frames.map((f) => f.rms));
	return frames
		.filter((f) => f.rms > loudest - 20)
		.map(({ midi, freq, db }) => ({ midi, freq, db }));
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
 * gain for each frame and the best tilt per octave of frequency.
 */
function misfit(frames: Frame[], formants: number[]) {
	const fr = { freq: five(formants), bw: BANDWIDTHS };
	// Least squares of r = gain(frame) + tilt·x, with x the octaves of the frequency: the tilt from
	// the deviations of r and x from their frame's means, then the gains.
	const rs: number[][] = [],
		xs: number[][] = [];
	let sxx = 0,
		sxr = 0;
	for (const { freq, db } of frames) {
		const r = db.map((d, i) => d - 20 * Math.log10(cascade(fr, freq[i]))),
			x = freq.map((f) => Math.log2(f / 1000));
		const mr = r.reduce((s, v) => s + v, 0) / r.length,
			mx = x.reduce((s, v) => s + v, 0) / x.length;
		r.forEach((v, i) => {
			sxx += (x[i] - mx) ** 2;
			sxr += (x[i] - mx) * (v - mr);
		});
		rs.push(r.map((v) => v - mr));
		xs.push(x.map((v) => v - mx));
	}
	const tilt = sxx ? sxr / sxx : 0;
	let sum = 0,
		count = 0;
	rs.forEach((r, j) =>
		r.forEach((v, i) => {
			sum += (v - tilt * xs[j][i]) ** 2;
			count++;
		})
	);
	return Math.sqrt(sum / count);
}

const valid = ([f1, f2, f3]: number[]) => f1 > 180 && f2 > f1 * 1.25 && f3 > f2 * 1.1 && f3 < 4000;

/**
 * The formants F1 to F3 that fit the levels of `frames` best, and how far the levels are from
 * them in dB rms: from each vowel of Csound's table, the formants that a search moving one
 * formant at a time by ever smaller ratios finds, the best of those.
 */
export function fitFormants(frames: Frame[]) {
	let best = { formants: [0, 0, 0], error: Infinity };
	for (const start of vowelTable()) {
		let formants = start.slice(0, 3),
			error = misfit(frames, formants);
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
		if (error < best.error) best = { formants, error };
	}
	return { formants: best.formants.map(Math.round), error: best.error };
}

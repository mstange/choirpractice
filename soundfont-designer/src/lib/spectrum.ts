// The tone's spectrum, for build.ts and the plots.
import { eqCurve } from './dsp.ts';
import { CONTOUR_FREQS, CONTOUR_KEYS, type Patch } from './patch.ts';
import { vowelCurve } from './vowel.ts';

/**
 * The two neighbours that `x` falls between on the increasing `points`, and the weight of the
 * second; beyond the ends, the end.
 */
export function between(points: number[], x: number): [number, number, number] {
	const last = points.length - 1;
	if (last === 0 || x <= points[0]) return [0, 0, 0];
	if (x >= points[last]) return [last, last, 0];
	let i = 0;
	while (x >= points[i + 1]) i++;
	return [i, i + 1, (x - points[i]) / (points[i + 1] - points[i])];
}

export const CONTOUR_OCTAVES = CONTOUR_FREQS.map(Math.log2);

/**
 * The contour of `key`, between those of the registers on either side, and its gain in dB at `f`,
 * in between its frequencies along the logarithm of the frequency.
 */
export function contourCurve(contour: number[][], key: number) {
	const [a, b, t] = between(CONTOUR_KEYS, key),
		row = contour[a].map((v, j) => v + t * (contour[b][j] - v));
	return (f: number) => {
		const [i, k, u] = between(CONTOUR_OCTAVES, Math.log2(f));
		return row[i] + u * (row[k] - row[i]);
	};
}

/**
 * The gain in dB of the EQ, the vowel and the contour at `key`: what shapes the tone by
 * frequency.
 */
export function toneEq(p: Patch, key: number) {
	const eq = eqCurve(p.eq),
		vowel = vowelCurve(p.vowel, key),
		contour = contourCurve(p.contour, key);
	return (f: number) => eq(f) + vowel(f) + contour(f);
}

/**
 * Harmonics stay below this fraction of the sample rate, so that playing a zone's highest key
 * with vibrato doesn't alias.
 */
export const NYQUIST = 0.45;

/**
 * The harmonics of the tone of `key` at fundamental `f0`: their frequency and amplitude. Every key is as
 * loud at full dynamics: the harmonics have a total power of 1 after the EQ, the vowel, the
 * contour and the low-pass filter (which the synthesizer applies), so that these change the timbre and the level
 * the loudness.
 */
export function toneHarmonics(p: Patch, key: number, f0: number, sampleRate: number) {
	const { tilt, even, harmonics, maxHarmonic } = p.tone;
	const count = Math.min(maxHarmonic, Math.floor((NYQUIST * sampleRate) / f0));
	const eq = toneEq(p, key),
		lp = lowpass(p, f0);
	const list = Array.from({ length: count }, (_, i) => {
		const freq = (i + 1) * f0;
		const db = tilt * Math.log2(i + 1) + (i % 2 ? even : 0) + (harmonics[i] ?? 0) + eq(freq);
		return { freq, amp: 10 ** (db / 20) };
	});
	const norm = Math.sqrt(list.reduce((s, h) => s + (h.amp * lp(h.freq)) ** 2, 0));
	for (const h of list) h.amp /= norm;
	return list;
}

/** The gain of the tone's low-pass filter at full dynamics, for a zone at `f0`. */
export function lowpass(p: Patch, f0: number) {
	if (p.filter.harmonic >= 64) return () => 1;
	const fc = f0 * p.filter.harmonic,
		q = Math.SQRT1_2 * 10 ** (p.filter.q / 20);
	return (f: number) => 1 / Math.sqrt((1 - (f / fc) ** 2) ** 2 + (f / (fc * q)) ** 2);
}

/** The band of the breath noise, a gentle band-pass: its gain at `f`. */
export const noiseShape = (f: number, low: number, high: number) =>
	1 / Math.sqrt((1 + (low / f) ** 4) * (1 + (f / high) ** 4));

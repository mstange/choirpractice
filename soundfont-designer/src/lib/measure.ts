// Measures the sustain of notes as spessasynth renders them, per harmonic, and fits a patch's
// contour to another instrument's: for scripts/spectrum.ts and the Match button.
import { BasicSoundBank, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';
import { buildBank } from './build.ts';
import { ifft, keyFreq } from './dsp.ts';
import { CONTOUR_FREQS, type Patch } from './patch.ts';

export const RATE = 32000,
	N = 2 ** 15;
const FROM = 1.5,
	TO = 4.5,
	VELOCITY = 80;
/** The keys that a contour is fitted on, across the vocal parts' range. */
export const MATCH_KEYS = [40, 46, 52, 58, 64, 70, 76];

export const db = (p: number) => 10 * Math.log10(p + 1e-30);
const median = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1];

/** A patch's bank as the page plays it, written as SF2 and read back, with its preset at 0. */
export function patchBank(patch: Patch) {
	return SoundBankLoader.fromArrayBuffer(
		buildBank(patch, 0).bank.writeSF2({ writeDefaultModulators: true })
	);
}

/** Both channels of a note at mf, with CC2 at the velocity, from FROM to TO seconds. */
export function render(bank: BasicSoundBank, program: number, key: number) {
	const synth = new SpessaSynthProcessor(RATE, { effectsEnabled: false });
	synth.soundBankManager.addSoundBank(bank, 'b');
	synth.programChange(0, program);
	synth.controllerChange(0, 2, VELOCITY);
	synth.noteOn(0, key, VELOCITY);
	const l = new Float32Array(TO * RATE),
		r = new Float32Array(TO * RATE);
	for (let i = 0; i < l.length; i += 128) synth.process(l, r, i, 128);
	return [l.slice(FROM * RATE), r.slice(FROM * RATE)];
}

/** Power spectrum, Welch's method with a Hann window, both channels summed. */
export function spectrum(channels: Float32Array[]) {
	const power = new Float64Array(N / 2),
		win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
	for (const x of channels)
		for (let start = 0; start + N <= x.length; start += N / 4) {
			const re = new Float64Array(N),
				im = new Float64Array(N);
			for (let i = 0; i < N; i++) re[i] = x[start + i] * win[i];
			ifft(re, im); // of a real signal, the conjugate of the forward transform
			for (let k = 0; k < N / 2; k++) power[k] += re[k] ** 2 + im[k] ** 2;
		}
	return power;
}

/**
 * The power in bins `lo` to `hi` above `floor` per bin, and its spread: twice the power-weighted
 * standard deviation, in cents around its center.
 */
export function peak(power: Float64Array, lo: number, hi: number, floor: number) {
	let sum = 0,
		m1 = 0,
		m2 = 0;
	for (let k = lo; k <= hi; k++) {
		const p = Math.max(0, power[k] - floor);
		sum += p;
		m1 += p * k;
		m2 += p * k * k;
	}
	const center = m1 / sum,
		sd = Math.sqrt(Math.max(0, m2 / sum - center * center));
	return { sum, center, cents: 1200 * Math.log2((center + sd) / (center - sd)) };
}

export type Harmonic = { level: number; noise: number; cents: number };

/**
 * Per harmonic below 10 kHz: its power (within ±1/4 of the fundamental), the noise (the median
 * bin in the middle half between it and the next harmonic, times the bins of a harmonic's
 * window), and its spread in cents.
 */
export function harmonics(power: Float64Array, f0: number): Harmonic[] {
	const bin = RATE / N,
		list = [];
	for (let h = 1; (h + 0.75) * f0 < Math.min(10000, RATE / 2); h++) {
		const lo = Math.round(((h - 0.25) * f0) / bin),
			hi = Math.round(((h + 0.25) * f0) / bin),
			gap = [];
		for (let k = hi; k <= Math.round(((h + 0.75) * f0) / bin); k++) gap.push(power[k]);
		const floor = median(gap),
			{ sum, cents } = peak(power, lo, hi, floor);
		list.push({ level: sum, noise: floor * (hi - lo + 1), cents });
	}
	return list;
}

export const measure = (bank: BasicSoundBank, program: number, key: number) =>
	harmonics(spectrum(render(bank, program, key)), keyFreq(key));

/** Solves `a x = b` by Gaussian elimination, in place. */
function solve(a: Float64Array[], b: Float64Array) {
	const n = b.length;
	for (let c = 0; c < n; c++) {
		let p = c;
		for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
		[a[c], a[p]] = [a[p], a[c]];
		[b[c], b[p]] = [b[p], b[c]];
		for (let r = c + 1; r < n; r++) {
			const f = a[r][c] / a[c][c];
			for (let k = c; k < n; k++) a[r][k] -= f * a[c][k];
			b[r] -= f * b[c];
		}
	}
	const x = new Float64Array(n);
	for (let r = n - 1; r >= 0; r--) {
		let s = b[r];
		for (let k = r + 1; k < n; k++) s -= a[r][k] * x[k];
		x[r] = s / a[r][r];
	}
	return x;
}

/** How much neighbouring points of the contour are held together, against one harmonic's error. */
const SMOOTH = 1;

/**
 * The change to the contour that brings the patch's harmonics, `ours[k]` on `keys[k]`, nearest
 * the reference's, `theirs[k]`: by least squares over the reference's harmonics that are above
 * its noise and within 50 dB of its strongest, with an offset of its own for each key, since
 * each key's tone is normalized to the same loudness. Also the rms error in dB of those
 * harmonics, before and after.
 */
export function fitContour(theirs: Harmonic[][], ours: Harmonic[][], keys: number[]) {
	const n = CONTOUR_FREQS.length,
		m = n + keys.length;
	const rows: { terms: [number, number][]; e: number }[] = [];
	keys.forEach((key, k) => {
		const f0 = keyFreq(key),
			top = Math.max(...theirs[k].map((h) => h.level)),
			ourTop = Math.max(...ours[k].map((h) => h.level));
		theirs[k].forEach((h, i) => {
			const o = ours[k][i];
			if (!o || h.level <= h.noise || db(h.level / top) < -50 || db(o.level / ourTop) < -70) return;
			const x = Math.max(0, Math.min(n - 1, 3 * Math.log2(((i + 1) * f0) / CONTOUR_FREQS[0]))),
				j = Math.min(n - 2, Math.floor(x)),
				t = x - j;
			rows.push({
				terms: [
					[j, 1 - t],
					[j + 1, t],
					[n + k, 1]
				],
				e: db(h.level) - db(o.level)
			});
		});
	});
	const a = Array.from({ length: m }, () => new Float64Array(m)),
		b = new Float64Array(m);
	for (const { terms, e } of rows)
		for (const [p, wp] of terms) {
			b[p] += wp * e;
			for (const [q, wq] of terms) a[p][q] += wp * wq;
		}
	for (let j = 0; j < n; j++) {
		// A little of the contour's own size keeps it determined, where only smoothness holds it.
		a[j][j] += 0.01;
		if (j < n - 1) {
			a[j][j] += SMOOTH;
			a[j + 1][j + 1] += SMOOTH;
			a[j][j + 1] -= SMOOTH;
			a[j + 1][j] -= SMOOTH;
		}
	}
	const x = solve(a, b);
	const rms = (f: (r: (typeof rows)[0]) => number) =>
		Math.sqrt(rows.reduce((s, r) => s + f(r) ** 2, 0) / rows.length);
	// Before: with the best offset of each key alone, the mean error of its harmonics.
	const mean = keys.map((_, k) => {
		const own = rows.filter((r) => r.terms[2][0] === n + k);
		return own.reduce((s, r) => s + r.e, 0) / own.length;
	});
	return {
		change: Array.from(x.subarray(0, n)),
		before: rms((r) => r.e - mean[r.terms[2][0] - n]),
		after: rms((r) => r.e - r.terms.reduce((s, [p, w]) => s + w * x[p], 0))
	};
}

/**
 * The patch's contour changed to bring its sustain nearest that of `program` in `reference`, on
 * MATCH_KEYS, with its highest point at 0 dB, and the rms error per harmonic before and after.
 */
export function matchContour(reference: BasicSoundBank, program: number, patch: Patch) {
	const ours = patchBank(patch);
	const fit = fitContour(
		MATCH_KEYS.map((key) => measure(reference, program, key)),
		MATCH_KEYS.map((key) => measure(ours, 0, key)),
		MATCH_KEYS
	);
	const raw = patch.contour.map((v, j) => v + fit.change[j]),
		top = Math.max(...raw);
	return {
		contour: raw.map((v) => Math.max(-60, Math.round((v - top) * 2) / 2)),
		before: fit.before,
		after: fit.after
	};
}

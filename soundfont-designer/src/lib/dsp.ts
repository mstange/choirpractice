// FFT, biquad filters and a seeded random number generator, for build.ts and the plots.
import type { EqBand } from './patch.ts';

/** Per FFT length n: cos and sin of 2πj/n, for j < n/2. */
const twiddles = new Map<number, [Float64Array, Float64Array]>();

/** In-place inverse FFT without scaling, of a power-of-two length: x[n] = Σ X[k] e^(2πikn/N). */
export function ifft(re: Float64Array, im: Float64Array) {
	const n = re.length;
	if (!twiddles.has(n)) {
		const c = new Float64Array(n / 2),
			s = new Float64Array(n / 2);
		for (let j = 0; j < n / 2; j++) {
			c[j] = Math.cos((2 * Math.PI * j) / n);
			s[j] = Math.sin((2 * Math.PI * j) / n);
		}
		twiddles.set(n, [c, s]);
	}
	const [cos, sin] = twiddles.get(n)!;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const half = len >> 1,
			step = n / len;
		for (let i = 0; i < n; i += len)
			for (let k = 0; k < half; k++) {
				const a = i + k,
					b = a + half,
					cr = cos[k * step],
					ci = sin[k * step];
				const tr = re[b] * cr - im[b] * ci,
					ti = re[b] * ci + im[b] * cr;
				re[b] = re[a] - tr;
				im[b] = im[a] - ti;
				re[a] += tr;
				im[a] += ti;
			}
	}
}

/** Biquad coefficients [b0, b1, b2, a1, a2], normalized, from the Audio EQ Cookbook. */
export function biquad({ type, freq, gain, q }: EqBand, sampleRate: number) {
	const A = 10 ** (gain / 40),
		w = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate,
		cos = Math.cos(w),
		alpha = Math.sin(w) / (2 * q);
	let c: number[];
	if (type === 'peak')
		c = [1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A];
	else {
		const s = type === 'lowshelf' ? 1 : -1,
			r = 2 * Math.sqrt(A) * alpha;
		c = [
			A * (A + 1 - s * (A - 1) * cos + r),
			s * 2 * A * (A - 1 - s * (A + 1) * cos),
			A * (A + 1 - s * (A - 1) * cos - r),
			A + 1 + s * (A - 1) * cos + r,
			-s * 2 * (A - 1 + s * (A + 1) * cos),
			A + 1 + s * (A - 1) * cos - r
		];
	}
	const a0 = c[3];
	return [c[0] / a0, c[1] / a0, c[2] / a0, c[4] / a0, c[5] / a0];
}

/** The rate at which EQ curves are computed, so that they don't depend on a sample rate. */
const EQ_RATE = 96000;

/** The gain in dB of a chain of EQ bands, as a function of frequency. */
export function eqCurve(bands: EqBand[]) {
	const coefs = bands.filter((b) => b.gain !== 0).map((b) => biquad(b, EQ_RATE));
	return (freq: number) => {
		const w = (2 * Math.PI * freq) / EQ_RATE;
		const c1 = Math.cos(w),
			s1 = Math.sin(w),
			c2 = Math.cos(2 * w),
			s2 = Math.sin(2 * w);
		let db = 0;
		for (const [b0, b1, b2, a1, a2] of coefs) {
			const nr = b0 + b1 * c1 + b2 * c2,
				ni = -b1 * s1 - b2 * s2,
				dr = 1 + a1 * c1 + a2 * c2,
				di = -a1 * s1 - a2 * s2;
			db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
		}
		return db;
	};
}

/** Filters `x` in place through a chain of biquads. */
export function filter(x: Float32Array, bands: EqBand[], sampleRate: number) {
	for (const band of bands) {
		const [b0, b1, b2, a1, a2] = biquad(band, sampleRate);
		let x1 = 0,
			x2 = 0,
			y1 = 0,
			y2 = 0;
		for (let i = 0; i < x.length; i++) {
			const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
			x2 = x1;
			x1 = x[i];
			y2 = y1;
			y1 = x[i] = y;
		}
	}
}

/** Mulberry32: uniform numbers in [0, 1) from a seed. */
export function random(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export const keyFreq = (key: number) => 440 * 2 ** ((key - 69) / 12);

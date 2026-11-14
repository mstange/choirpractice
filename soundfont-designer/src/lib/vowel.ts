// The vowel: a vocal tract's resonances, as a gain in dB against a neutral vowel's, per register.
import { CONTOUR_KEYS, type Patch, type Vowel } from './patch.ts';
import { between } from './dsp.ts';

/** Formant frequencies and bandwidths in Hz, of five formants. */
type Formants = { freq: number[]; bw: number[] };

/** Csound's formant table: per voice, per vowel, frequencies and bandwidths. */
const TABLE: Record<string, Record<Vowel, [number[], number[]]>> = {
	bass: {
		a: [
			[600, 1040, 2250, 2450, 2750],
			[60, 70, 110, 120, 130]
		],
		e: [
			[400, 1620, 2400, 2800, 3100],
			[40, 80, 100, 120, 120]
		],
		i: [
			[250, 1750, 2600, 3050, 3340],
			[60, 90, 100, 120, 120]
		],
		o: [
			[400, 750, 2400, 2600, 2900],
			[40, 80, 100, 120, 120]
		],
		u: [
			[350, 600, 2400, 2675, 2950],
			[40, 80, 100, 120, 120]
		]
	},
	tenor: {
		a: [
			[650, 1080, 2650, 2900, 3250],
			[80, 90, 120, 130, 140]
		],
		e: [
			[400, 1700, 2600, 3200, 3580],
			[70, 80, 100, 120, 120]
		],
		i: [
			[290, 1870, 2800, 3250, 3540],
			[40, 90, 100, 120, 120]
		],
		o: [
			[400, 800, 2600, 2800, 3000],
			[40, 80, 100, 120, 120]
		],
		u: [
			[350, 600, 2700, 2900, 3300],
			[40, 60, 100, 120, 120]
		]
	},
	soprano: {
		a: [
			[800, 1150, 2900, 3900, 4950],
			[80, 90, 120, 130, 140]
		],
		e: [
			[350, 2000, 2800, 3600, 4950],
			[60, 100, 120, 150, 200]
		],
		i: [
			[270, 2140, 2950, 3900, 4950],
			[60, 90, 100, 120, 120]
		],
		o: [
			[450, 800, 2830, 3800, 4950],
			[40, 80, 100, 120, 120]
		],
		u: [
			[325, 700, 2700, 3800, 4950],
			[50, 60, 170, 180, 200]
		]
	}
};

/** The voice of each register of CONTOUR_KEYS: E2, A#3 and E5. */
export const REGISTER_VOICES = ['bass', 'tenor', 'soprano'];

export const VOWELS: Vowel[] = ['a', 'e', 'i', 'o', 'u'];

/** The formant frequencies of every voice and vowel of the table. */
export const vowelTable = () =>
	Object.values(TABLE).flatMap((voice) => VOWELS.map((v) => voice[v][0]));

const geomean = (a: number[]) => Math.exp(a.reduce((s, v) => s + Math.log(v), 0) / a.length);

/** Per register, the formants of each vowel, and of the neutral vowel: their geometric mean. */
const REGISTERS = REGISTER_VOICES.map((voice) => {
	const table = TABLE[voice],
		vowels = Object.fromEntries(
			VOWELS.map((v) => [v, { freq: table[v][0], bw: table[v][1] }])
		) as Record<Vowel, Formants>;
	const mean = (f: (x: Formants) => number[]) =>
		[0, 1, 2, 3, 4].map((i) => geomean(VOWELS.map((v) => f(vowels[v])[i])));
	return { ...vowels, neutral: { freq: mean((x) => x.freq), bw: mean((x) => x.bw) } };
});

/** The gain of a cascade of resonators, 1 at 0 Hz, at `f`. */
export function cascade({ freq, bw }: Formants, f: number) {
	let g = 1;
	for (let i = 0; i < freq.length; i++) {
		const s = Math.PI * bw[i],
			w = 2 * Math.PI * freq[i],
			x = 2 * Math.PI * f;
		g *= (s * s + w * w) / Math.sqrt((s * s + (x - w) ** 2) * (s * s + (x + w) ** 2));
	}
	return g;
}

/**
 * The formants of `vowel` (or the neutral vowel) at `key`: between those of the registers on
 * either side along the logarithm of the frequency, with the bandwidths times `width`.
 */
function formants(v: Vowel | 'neutral', key: number, width: number): Formants {
	const [a, b, t] = between(CONTOUR_KEYS, key),
		mix = (x: number, y: number) => x ** (1 - t) * y ** t,
		fa = REGISTERS[a][v],
		fb = REGISTERS[b][v];
	return {
		freq: fa.freq.map((f, i) => mix(f, fb.freq[i])),
		bw: fa.bw.map((w, i) => width * mix(w, fb.bw[i]))
	};
}

/**
 * The vowel's gain in dB at `key` as a function of frequency: its vocal tract's against a neutral
 * one's of the same voice, times the amount. The sung vowel has the formants of a, F1 to F3 moved
 * by the ratios of the user's vowel to their a, so that each register keeps its voice.
 */
export function vowelCurve({ vowel, amount, width, sung }: Patch['vowel'], key: number) {
	if (amount === 0) return () => 0;
	const fv = formants(vowel === 'sung' ? 'a' : vowel, key, width),
		fn = formants('neutral', key, width);
	if (vowel === 'sung') fv.freq = fv.freq.map((f, i) => f * (sung[i] ?? 1));
	return (f: number) => amount * 20 * Math.log10(cascade(fv, f) / cascade(fn, f));
}

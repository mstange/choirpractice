// The vowel: a vocal tract's resonances, as a gain in dB against a neutral vowel's, per register.
import {
	CONTOUR_KEYS,
	EDITING_BANK,
	type Formants,
	type Patch,
	type Vowel,
	type VowelFormants
} from './patch.ts';
import { atKey, between } from './dsp.ts';
import {
	nearest,
	VOWEL_BANK,
	VOWELS as LYRIC_VOWELS,
	type Ipa
} from '../../../site/src/lib/vowels.ts';

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

/** The voice of the table at each of CONTOUR_KEYS: E2, A#3 and E5. */
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
 * The formants of `vowel` (or the neutral vowel) of the table at `key`: between those of its voices
 * on either side along the logarithm of the frequency, with the bandwidths times `width`.
 */
function formants(v: Vowel | 'neutral', key: number, width: number): Formants {
	return formantsAt(
		CONTOUR_KEYS,
		REGISTERS.map((r) => r[v]),
		key,
		width
	);
}

/**
 * The formants at `key` of `registers`, one per key of `keys`: between those on either side along
 * the logarithm of the frequency, with the bandwidths times `width`.
 */
function formantsAt(keys: number[], registers: Formants[], key: number, width: number): Formants {
	const [a, b, t] = between(keys, key),
		mix = (x: number, y: number) => x ** (1 - t) * y ** t,
		fa = registers[a],
		fb = registers[b];
	return {
		freq: fa.freq.map((f, i) => mix(f, fb.freq[i])),
		bw: fa.bw.map((w, i) => width * mix(w, fb.bw[i]))
	};
}

/** The formants that a vowel sings on `key`. */
function keyFormants({ vowel, sung, registers }: VowelFormants, p: Patch, key: number) {
	if (vowel === 'fitted' && registers) return formantsAt(p.registerKeys, registers, key, 1);
	const f = formants(vowel === 'sung' || vowel === 'fitted' ? 'a' : vowel, key, p.vowel.width);
	if (vowel === 'sung') f.freq = f.freq.map((x, i) => x * (sung[i] ?? 1));
	return f;
}

/**
 * The vowel's gain in dB at `key` as a function of frequency: its vocal tract's against a neutral
 * one's of the same voice, times the amount. The sung vowel has the formants of a, F1 to F3 moved
 * by the ratios of the user's vowel to their a, so that each register keeps its voice; the fitted
 * vowel has its own per register.
 */
export function vowelCurve(f: VowelFormants, p: Patch, key: number) {
	const { amount, width } = p.vowel;
	if (amount === 0) return () => 0;
	const fv = keyFormants(f, p, key),
		fn = formants('neutral', key, width);
	return (x: number) => amount * 20 * Math.log10(cascade(fv, x) / cascade(fn, x));
}

/**
 * The formants of a vowel on each of `keys` (by default the patch's registers), as vowelCurve()
 * sings them, with the patch's formant width.
 */
export function registerFormants(f: VowelFormants, p: Patch, keys = p.registerKeys): Formants[] {
	return keys.map((k) => keyFormants(f, p, k));
}

/**
 * `p` with its registers at `keys`: its contour, its noise between the harmonics and its fitted
 * vowels' formants and contours, as they were on those keys.
 */
export function withRegisters(p: Patch, keys: number[]): Patch {
	const q = structuredClone(p),
		rows = (r: number[][]) => keys.map((k) => atKey(p.registerKeys, r, k)),
		values = (v: number[]) => rows(v.map((x) => [x])).map(([x]) => Math.round(x * 10) / 10),
		vowels = (set: Patch['vowels']) => {
			for (const f of Object.values(set)) {
				const r = f.registers;
				if (r) f.registers = keys.map((k) => roundFormants(formantsAt(p.registerKeys, r, k, 1)));
				if (f.contour) f.contour = rows(f.contour).map((r) => r.map(half));
			}
		};
	q.registerKeys = [...keys];
	q.contour = rows(p.contour).map((r) => r.map(half));
	q.tone.aperiodic = values(p.tone.aperiodic);
	q.tone.aperiodicTilt = values(p.tone.aperiodicTilt);
	vowels(q.vowels);
	return q;
}

const half = (v: number) => Math.round(v * 2) / 2,
	roundFormants = ({ freq, bw }: Formants) => ({
		freq: freq.map(Math.round),
		bw: bw.map(Math.round)
	});

/** What the samples of a vowel's formants depend on: not what a vowel of the table keeps. */
export const formantsKey = ({ vowel, sung, registers, contour }: VowelFormants) =>
	JSON.stringify([
		vowel === 'sung' ? sung : vowel === 'fitted' ? registers : vowel,
		contour ?? null
	]);

/** The vowel of the table that a sung vowel's ratios come nearest, as a tenor's, by F1 and F2. */
export function nearestInTable(sung: number[]): Vowel {
	const { a } = REGISTERS[1],
		distance = (v: Vowel) =>
			[0, 1].reduce(
				(s, i) => s + Math.log((a.freq[i] * sung[i]) / REGISTERS[1][v].freq[i]) ** 2,
				0
			);
	return VOWELS.reduce((best, v) => (distance(v) < distance(best) ? v : best));
}

/** The vowels of Csound's formant table (see vowel.ts), as the choir app's. */
export const TABLE_VOWELS: Partial<Record<Ipa, Vowel>> = { a: 'a', e: 'e', i: 'i', o: 'o', u: 'u' };

/**
 * The formants that the patch sings `ipa` with, and the vowel that they are: the first of the
 * vowel and those nearest it that is designed or in Csound's table, the designed one if both.
 */
export function vowelFormants(p: Patch, ipa: Ipa): { from: Ipa; formants: VowelFormants } {
	const from = nearest(ipa).find((v) => p.vowels[v] || TABLE_VOWELS[v])!;
	return {
		from,
		formants: p.vowels[from] ?? { vowel: TABLE_VOWELS[from]!, sung: [1, 1, 1], measured: [] }
	};
}

/** The formants of the selected vowel. */
export const selectedFormants = (p: Patch) => vowelFormants(p, p.selected).formants;

/** The "ah" that sung vowels are measured against, F1 to F3 in Hz, if it was sung. */
export const sungAh = (p: Patch): number[] | undefined => p.vowels.a?.measured[0];

/** A preset of the patch: its bank, its vowel's name, and the formants and their vowel's name. */
type VowelPreset = { bank: number; name: string; formants: VowelFormants; from: string };

/**
 * The presets of a patch: with `oneVowel` (or with `set` false), one at bank 0 with the selected
 * vowel; else one for each of the choir app's vowels, in its bank, and with `editing`, one with
 * the selected vowel at EDITING_BANK, for the keyboard.
 */
export function vowelSet(p: Patch, { set = true, editing = false } = {}): VowelPreset[] {
	const own = selectedFormants(p);
	if (!set || p.oneVowel) return [{ bank: 0, name: '', formants: own, from: '' }];
	const presets: VowelPreset[] = LYRIC_VOWELS.map(({ ipa, name }, bank) => {
		const { from, formants } = vowelFormants(p, ipa);
		return { bank, name, formants, from: LYRIC_VOWELS[VOWEL_BANK.get(from)!].name };
	});
	if (editing)
		presets.push({ bank: EDITING_BANK, name: 'editing', formants: own, from: 'editing' });
	return presets;
}

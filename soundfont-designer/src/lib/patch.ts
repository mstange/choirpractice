// The parameters of a designed instrument, from which build.ts makes a sound bank.

export type EqType = 'lowshelf' | 'peak' | 'highshelf';
export type EqBand = { type: EqType; freq: number; gain: number; q: number };
export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u';

/**
 * An instrument of two layers that sound together on every note: a sustained tone, a looped
 * spectrum of harmonics that follows the dynamics during the note, and an attack, a short
 * transient that marks where the note starts.
 */
export interface Patch {
	name: string;
	tone: {
		level: number;
		/** dB per octave of harmonic number: -6 is a sawtooth, -12 a triangle. */
		tilt: number;
		/** dB added to the even harmonics: very negative is a square or triangle. */
		even: number;
		/** dB added to harmonics 1, 2, …, HARMONICS. */
		harmonics: number[];
		/** The highest harmonic. */
		maxHarmonic: number;
		/**
		 * Copies of each harmonic above the fundamental, detuned at random against each other, for a
		 * sound like several singers.
		 */
		voices: number;
		/** The most cents between two copies. */
		detune: number;
		/**
		 * In percent: 0 is one mono sample per zone; above, a left and a right sample, each with an
		 * ensemble of its own, panned apart by this much (100 is hard left and right).
		 */
		width: number;
		/** Level of the breath noise against the harmonics, in dB. */
		noise: number;
		noiseLow: number;
		noiseHigh: number;
	};
	/** Vocal formants, as peaks of an EQ on the tone. */
	formant: { vowel: Vowel; amount: number; width: number };
	/** Applied to both layers, at the same frequencies on every key. */
	eq: EqBand[];
	/**
	 * dB added to the tone, harmonics and breath noise, per register of CONTOUR_KEYS at
	 * CONTOUR_FREQS: in between along the logarithm of the frequency, and from key to key in
	 * between the registers.
	 */
	contour: number[][];
	/** The tone's volume envelope, in ms and dB. */
	env: { attack: number; hold: number; decay: number; sustain: number; release: number };
	/** At the start of each note, the tone is brighter and can start flat, for `time` ms. */
	onset: { time: number; bright: number; scoop: number };
	vibrato: { rate: number; depth: number; delay: number };
	tremolo: { rate: number; depth: number };
	/** A low-pass filter on the tone at this harmonic, and its resonance in dB. */
	filter: { harmonic: number; q: number };
	/**
	 * What sets the tone's loudness and brightness: MuseScore exports the dynamics, hairpins
	 * included, as CC2 (breath controller), which can change during a note; the velocity can't.
	 * `range` is the volume modulator's depth in dB (96 is the SF2 default for velocity),
	 * `brightness` how many cents lower the filter is at the softest than at the loudest.
	 */
	dynamics: { source: 'cc2' | 'velocity'; range: number; brightness: number };
	attack: {
		enabled: boolean;
		/** dB against the tone. */
		level: number;
		/** ms in which the fundamental decays by 1/e. */
		decay: number;
		/** How much faster higher partials decay: harmonic h decays 1 + damping·(h-1) times faster. */
		damping: number;
		tilt: number;
		/** Stretches the partials like a piano string's, from 0 (harmonic) to 1. */
		inharmonicity: number;
		/** The noise burst, in dB against the partials, its center frequency and decay in ms. */
		noise: number;
		noiseFreq: number;
		noiseDecay: number;
		/** The velocity modulator's depth in dB. */
		velRange: number;
	};
	output: {
		/** Semitones between the keys that get a sample. */
		spacing: number;
		/** Length of the tone's loop in seconds, and the sample rate. */
		loop: number;
		sampleRate: number;
		/** Effect sends in percent, on top of what the MIDI file's CC91 and CC93 add. */
		reverb: number;
		chorus: number;
		/** Of the random phases. */
		seed: number;
	};
}

export const HARMONICS = 32;

/** Third octaves from 50 Hz to 12.7 kHz. */
export const CONTOUR_FREQS = Array.from({ length: 25 }, (_, i) => 50 * 2 ** (i / 3));
/** The keys of the contour's registers: E2 and E5. */
export const CONTOUR_KEYS = [40, 76];
/** The keys that Match fits the contour on, across the vocal parts' range. */
export const MATCH_KEYS = [40, 46, 52, 58, 64, 70, 76];

export const DEFAULT_PATCH: Patch = {
	name: 'Practice Voice',
	tone: {
		level: 0,
		tilt: -8,
		even: 0,
		harmonics: Array(HARMONICS).fill(0),
		maxHarmonic: 48,
		voices: 3,
		detune: 14,
		width: 0,
		noise: -32,
		noiseLow: 1500,
		noiseHigh: 7000
	},
	formant: { vowel: 'a', amount: 0.6, width: 2 },
	eq: [
		{ type: 'lowshelf', freq: 150, gain: 0, q: 0.7 },
		{ type: 'peak', freq: 800, gain: 0, q: 1 },
		{ type: 'peak', freq: 3000, gain: 3, q: 1.2 },
		{ type: 'highshelf', freq: 8000, gain: -3, q: 0.7 }
	],
	contour: CONTOUR_KEYS.map(() => Array(CONTOUR_FREQS.length).fill(0)),
	env: { attack: 25, hold: 0, decay: 300, sustain: -3, release: 180 },
	onset: { time: 90, bright: 1200, scoop: 0 },
	vibrato: { rate: 5.3, depth: 12, delay: 450 },
	tremolo: { rate: 5.3, depth: 0 },
	filter: { harmonic: 20, q: 0 },
	dynamics: { source: 'cc2', range: 72, brightness: 2400 },
	attack: {
		enabled: true,
		level: 0,
		decay: 140,
		damping: 0.4,
		tilt: -6,
		inharmonicity: 0,
		noise: -18,
		noiseFreq: 3000,
		noiseDecay: 15,
		velRange: 72
	},
	output: { spacing: 3, loop: 2, sampleRate: 32000, reverb: 0, chorus: 0, seed: 1 }
};

/** A copy of `p` with whatever `DEFAULT_PATCH` has that `p` lacks, for patches saved earlier. */
export function complete(p: Partial<Patch>): Patch {
	const d = structuredClone(DEFAULT_PATCH) as unknown as Record<string, unknown>;
	for (const [k, v] of Object.entries(p))
		d[k] =
			v && typeof v === 'object' && !Array.isArray(v)
				? { ...(d[k] as object), ...structuredClone(v) }
				: structuredClone(v);
	// A contour of one register, as patches had it at first, is every register's.
	const contour = d.contour as number[] | number[][];
	if (typeof contour[0] === 'number') d.contour = CONTOUR_KEYS.map(() => [...contour]);
	return d as unknown as Patch;
}

/** Formants of a tenor (Csound's formant table): frequency, level in dB, bandwidth. */
export const FORMANTS: Record<Vowel, [number, number, number][]> = {
	a: [
		[650, 0, 80],
		[1080, -6, 90],
		[2650, -7, 120],
		[2900, -8, 130],
		[3250, -22, 140]
	],
	e: [
		[400, 0, 70],
		[1700, -14, 80],
		[2600, -12, 100],
		[3200, -14, 120],
		[3580, -20, 120]
	],
	i: [
		[290, 0, 40],
		[1870, -15, 90],
		[2800, -18, 100],
		[3250, -20, 120],
		[3540, -30, 120]
	],
	o: [
		[400, 0, 40],
		[800, -10, 80],
		[2600, -12, 100],
		[2800, -12, 120],
		[3000, -26, 120]
	],
	u: [
		[350, 0, 40],
		[600, -20, 60],
		[2700, -17, 100],
		[2900, -14, 120],
		[3300, -26, 120]
	]
};

/** The height in dB of the strongest formant's peak at amount 1. */
const FORMANT_PEAK = 18;

/** The formants as EQ bands. */
export function formantBands({ vowel, amount, width }: Patch['formant']): EqBand[] {
	return FORMANTS[vowel].map(([freq, level, bw]) => ({
		type: 'peak',
		freq,
		gain: amount * Math.max(0, FORMANT_PEAK + level),
		q: freq / (bw * width)
	}));
}

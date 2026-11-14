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
		 * Copies of each harmonic, detuned at random against each other, for a sound like several
		 * singers.
		 */
		voices: number;
		/** The most cents between two copies. */
		detune: number;
		/**
		 * The same for the fundamental's copies, which beat into a throb of the whole note; 0 is a
		 * fundamental without copies.
		 */
		fundamentalDetune: number;
		/**
		 * In percent: 0 is one mono sample per zone; above, a left and a right sample, each with an
		 * ensemble of its own, panned apart by this much (100 is hard left and right).
		 */
		width: number;
		/** Level of the breath noise against the harmonics, in dB. */
		noise: number;
		noiseLow: number;
		noiseHigh: number;
		/**
		 * Noise between the harmonics, shaped like them: the noise between two neighbouring
		 * harmonics, in dB against them, at 1 kHz on C4 (-90 is none), how much that changes per
		 * octave of key, and per octave of frequency.
		 */
		aperiodic: number;
		aperiodicSlope: number;
		aperiodicTilt: number;
	};
	/**
	 * The vowel, on the tone: its vocal tract's resonances against a neutral vowel's, in dB times
	 * `amount`, with the formant bandwidths times `width` (see vowel.ts).
	 */
	vowel: { vowel: Vowel; amount: number; width: number };
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
/** The keys of the contour's registers: E2, A#3 and E5. */
export const CONTOUR_KEYS = [40, 58, 76];
/**
 * The keys that Match fits the contour on, across the vocal parts' range: every third key, one in
 * each of Choir Aahs's zones.
 */
export const MATCH_KEYS = Array.from({ length: 14 }, (_, i) => 40 + 3 * i);

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
		fundamentalDetune: 0,
		width: 0,
		noise: -32,
		noiseLow: 1500,
		noiseHigh: 7000,
		aperiodic: -90,
		aperiodicSlope: 0,
		aperiodicTilt: 0
	},
	vowel: { vowel: 'a', amount: 0.2, width: 1 },
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
	// A contour of one register, as patches had it at first, is every register's; one of E2 and E5
	// has A#3 halfway between them.
	const contour = d.contour as number[] | number[][];
	if (typeof contour[0] === 'number') d.contour = CONTOUR_KEYS.map(() => [...contour]);
	else if (contour.length === 2) {
		const [low, high] = contour as number[][];
		d.contour = [low, low.map((v, j) => (v + high[j]) / 2), high];
	}
	// Patches saved earlier had their formants as EQ peaks of a tenor's, which a third of the
	// amount at half the width comes near.
	if ('formant' in p) {
		const { vowel, amount, width } = (p as { formant: Patch['vowel'] }).formant;
		d.vowel = { vowel, amount: Math.round((amount / 3) * 20) / 20, width: width / 2 };
		delete d.formant;
	}
	return d as unknown as Patch;
}

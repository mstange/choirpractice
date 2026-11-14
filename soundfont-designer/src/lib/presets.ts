// Patches to start from, as changes to the default patch.
import { DEFAULT_PATCH, complete, type Patch, type Vowel } from './patch.ts';

const d = DEFAULT_PATCH;

// What the page starts with: as near MS Basic's Choir Aahs as the parameters come, measured with
// scripts/spectrum.ts: the vowel a at full strength, and the contour matched around it on every
// third key, without the filter, which would follow the key and take away the formants of other
// vowels on low keys, its noise between the harmonics, its wide harmonics, slow onset and long release, its
// level and its response to velocity, not CC2.
export const MS_BASIC_AAHS = complete({
	name: 'MS Basic Aahs',
	tone: {
		...d.tone,
		level: -2.5,
		voices: 7,
		detune: 45,
		fundamentalDetune: 30,
		width: 100,
		noise: -90,
		aperiodic: -28,
		aperiodicSlope: -11,
		aperiodicTilt: 7
	},
	vowel: { ...d.vowel, amount: 1, width: 1.5 },
	contour: [
		[
			-32, -32.5, -33, -34, -31, -24.5, -20, -16.5, -9, 0, -7.5, -24, -23.5, -27.5, -36, -36.5,
			-23.5, -22, -13, -18, -18.5, -17.5, -18.5, -19.5, -20
		],
		[
			-29, -29.5, -29.5, -30, -29, -26.5, -23.5, -19.5, -11.5, -2, -4.5, -17, -18.5, -17.5, -27.5,
			-33, -24.5, -15, -18.5, -28.5, -26.5, -24.5, -24, -24.5, -24.5
		],
		[
			-26.5, -26, -25.5, -24.5, -23, -21, -18.5, -15.5, -11.5, -7.5, -7.5, -12.5, -16.5, -15, -17.5,
			-23.5, -27, -19, -22.5, -30.5, -34.5, -35, -33, -31.5, -31
		]
	],
	env: { ...d.env, attack: 240, sustain: 0, release: 1700 },
	onset: { time: 90, bright: 0, scoop: 0 },
	vibrato: { ...d.vibrato, depth: 8 },
	filter: { harmonic: 64, q: 0 },
	dynamics: { source: 'velocity', range: 80, brightness: 0 },
	attack: { ...d.attack, enabled: false },
	output: { ...d.output, reverb: 15 }
});

/** MS Basic Aahs singing another vowel: the same contour, which is what isn't the vowel. */
const singing = (vowel: Vowel, name: string) =>
	complete({ ...MS_BASIC_AAHS, name, vowel: { ...MS_BASIC_AAHS.vowel, vowel } });

export const STARTING_POINTS: Patch[] = [
	MS_BASIC_AAHS,
	singing('o', 'Choir Ohs'),
	singing('u', 'Choir Uuus'),
	d,
	complete({
		name: 'Soft Aah',
		tone: { ...d.tone, tilt: -10, voices: 5, detune: 20, width: 100 },
		vowel: { ...d.vowel, amount: 0.3 },
		env: { ...d.env, attack: 90 },
		onset: { time: 90, bright: 0, scoop: 0 },
		attack: { ...d.attack, enabled: false }
	}),
	complete({
		name: 'Piano + Pad',
		tone: { ...d.tone, level: -3, tilt: -12, voices: 2, detune: 8 },
		vowel: { ...d.vowel, vowel: 'o', amount: 0.2, width: 3 },
		env: { ...d.env, attack: 160, decay: 600, sustain: 0 },
		onset: { time: 90, bright: 0, scoop: 0 },
		vibrato: { ...d.vibrato, depth: 0 },
		attack: {
			...d.attack,
			level: 6,
			decay: 700,
			damping: 0.6,
			tilt: -4,
			inharmonicity: 0.3,
			noise: -30
		}
	}),
	complete({
		name: 'Breathy Flute',
		tone: {
			...d.tone,
			tilt: -15,
			even: -4,
			voices: 1,
			noise: -20,
			noiseLow: 1000,
			noiseHigh: 9000
		},
		vowel: { ...d.vowel, amount: 0 },
		onset: { time: 60, bright: 1800, scoop: 0 },
		vibrato: { rate: 5, depth: 8, delay: 300 },
		attack: { ...d.attack, level: -10, decay: 40, noise: 6, noiseFreq: 2500, noiseDecay: 30 }
	}),
	complete({
		name: 'Reed',
		tone: { ...d.tone, tilt: -5, even: -14, voices: 1, noise: -40 },
		vowel: { ...d.vowel, amount: 0 },
		filter: { harmonic: 14, q: 3 },
		vibrato: { ...d.vibrato, depth: 0 },
		attack: { ...d.attack, level: -8, decay: 60, noise: -12 }
	})
];

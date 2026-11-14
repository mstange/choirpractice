// Patches to start from, as changes to the default patch.
import { DEFAULT_PATCH, complete, type Patch } from './patch.ts';

const d = DEFAULT_PATCH;

// What the page starts with: as near MS Basic's Choir Aahs as the parameters come, measured with
// scripts/spectrum.ts: its contour matched on every third key, its noise between the harmonics,
// its wide harmonics, slow onset and long release, its level and its response to velocity, not
// CC2.
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
	contour: [
		[
			-47.5, -48.5, -49.5, -51.5, -47.5, -38, -34, -35, -28, -18.5, -19.5, -35, -27, -36.5, -48,
			-36.5, -13.5, -18, -34.5, -20.5, -8.5, 0, -1.5, -4.5, -6
		],
		[
			-44, -44, -45, -45, -43.5, -39, -36, -34, -25.5, -15.5, -13.5, -22.5, -15, -17, -37, -35, -23,
			-14, -30.5, -33, -25, -20.5, -16.5, -17, -17
		],
		[
			-40.5, -40.5, -39.5, -38, -37, -35, -32, -29, -25, -21, -18.5, -20, -12.5, -8.5, -16.5, -26,
			-31, -21, -24, -32, -36, -36, -32, -29.5, -28.5
		]
	],
	env: { ...d.env, attack: 240, sustain: 0, release: 1700 },
	onset: { time: 90, bright: 0, scoop: 0 },
	vibrato: { ...d.vibrato, depth: 8 },
	dynamics: { source: 'velocity', range: 80, brightness: 0 },
	attack: { ...d.attack, enabled: false },
	output: { ...d.output, reverb: 15 }
});

export const STARTING_POINTS: Patch[] = [
	MS_BASIC_AAHS,
	d,
	complete({
		name: 'Soft Aah',
		tone: { ...d.tone, tilt: -10, voices: 5, detune: 20, width: 100 },
		formant: { vowel: 'a', amount: 0.8, width: 2 },
		env: { ...d.env, attack: 90 },
		onset: { time: 90, bright: 0, scoop: 0 },
		attack: { ...d.attack, enabled: false }
	}),
	complete({
		name: 'Piano + Pad',
		tone: { ...d.tone, level: -3, tilt: -12, voices: 2, detune: 8 },
		formant: { vowel: 'o', amount: 0.3, width: 2 },
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
		formant: { ...d.formant, amount: 0 },
		onset: { time: 60, bright: 1800, scoop: 0 },
		vibrato: { rate: 5, depth: 8, delay: 300 },
		attack: { ...d.attack, level: -10, decay: 40, noise: 6, noiseFreq: 2500, noiseDecay: 30 }
	}),
	complete({
		name: 'Reed',
		tone: { ...d.tone, tilt: -5, even: -14, voices: 1, noise: -40 },
		formant: { ...d.formant, amount: 0 },
		filter: { harmonic: 14, q: 3 },
		vibrato: { ...d.vibrato, depth: 0 },
		attack: { ...d.attack, level: -8, decay: 60, noise: -12 }
	})
];

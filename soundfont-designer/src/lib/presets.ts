// Patches to start from, as changes to the default patch.
import { DEFAULT_PATCH, complete, type Patch } from './patch.ts';

const d = DEFAULT_PATCH;

export const STARTING_POINTS: Patch[] = [
	d,
	complete({
		name: 'Soft Aah',
		tone: { ...d.tone, tilt: -10, voices: 5, detune: 20 },
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

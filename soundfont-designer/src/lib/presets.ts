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
	complete({ ...MS_BASIC_AAHS, name, selected: vowel });

export const STARTING_POINTS: Patch[] = [
	MS_BASIC_AAHS,
	singing('o', 'Choir Ohs'),
	// The vowel that the user sang as "oo": F1 and F2 near each other, low, which the table's oo
	// was too muted and unclear beside. The formants it came from weren't kept.
	complete({
		...MS_BASIC_AAHS,
		name: 'Choir Uuus',
		vowels: { u: { vowel: 'sung', sung: [0.54, 0.32, 0.77], measured: [] } },
		selected: 'u'
	}),
	// MS Basic Aahs fitted to a recorded choir, the Choral Singing Dataset's Locus iste, with
	// scripts/choir/ (see its README): the contour and the noise between the harmonics to the four
	// sections' notes on "ah"; each other vowel's formants and bandwidths per register, and a contour
	// of its own, to their notes on it (fit-vowels.ts); and the vibrato to that of the singers' mean
	// pitch.
	complete({
		...MS_BASIC_AAHS,
		name: 'Recorded Choir',
		tone: { ...MS_BASIC_AAHS.tone, aperiodic: -26, aperiodicSlope: -13, aperiodicTilt: 8 },
		vowels: {
			ɛ: {
				vowel: 'fitted',
				sung: [1, 1, 1],
				measured: [],
				registers: [
					{ freq: [374, 1444, 2251, 2450, 2750], bw: [399, 41, 151, 180, 195] },
					{ freq: [555, 1568, 2428, 2900, 3250], bw: [83, 220, 255, 195, 210] },
					{ freq: [663, 2032, 2817, 3900, 4950], bw: [42, 357, 281, 195, 210] }
				],
				contour: [
					[
						1.5, 1.5, 1.5, 1, 1, -0.5, -1.5, 0, 2, 3, 2, 4, -1, 2.5, 5, 8.5, 0, 6, -0.5, -8.5, -8.5,
						-6.5, -4.5, -4.5, -4.5
					],
					[
						2, 2, 2.5, 2.5, 3.5, 2.5, 3, 3.5, 2, 2, -3.5, 0.5, 1, -0.5, -0.5, -1, 1, 0, -1, -1.5,
						-2.5, -3, -5, -4.5, -5
					],
					[
						2.5, 2.5, 2.5, 2.5, 3, 3, 3, 3.5, 4, 6, 4.5, 1.5, 2.5, -0.5, -1, -4, -2.5, -2.5, -2,
						-0.5, -1, -3, -5.5, -9, -8.5
					]
				]
			},
			ɔ: {
				vowel: 'fitted',
				sung: [1, 1, 1],
				measured: [],
				registers: [
					{ freq: [541, 854, 2307, 2450, 2750], bw: [345, 206, 69, 180, 195] },
					{ freq: [603, 936, 2716, 2900, 3250], bw: [120, 117, 308, 195, 210] },
					{ freq: [618, 1201, 2973, 3900, 4950], bw: [133, 41, 388, 195, 210] }
				],
				contour: [
					[
						2, 2, 2, 1.5, 0, -0.5, 0, 0.5, 1.5, 2.5, 0.5, 1.5, 1.5, 2.5, 4, 2, -2, 2.5, 0.5, -5.5,
						-5, -4, -3.5, -3, -3
					],
					[
						1, 1, 1, 1, 0.5, 0.5, 2, 2, 1, 2.5, -2, -1.5, 0.5, 0.5, -2.5, -2.5, -3, 1, -0.5, -0.5,
						1, -1, -0.5, -1, -1
					],
					[
						1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 0.5, 0, 2.5, 2, 0, -4, -4, -2, -2, -2.5, -0.5, 1, -0.5, 0,
						0
					]
				]
			},
			i: {
				vowel: 'fitted',
				sung: [1, 1, 1],
				measured: [],
				registers: [
					{ freq: [248, 1648, 2300, 2450, 2750], bw: [399, 79, 257, 180, 195] },
					{ freq: [337, 1842, 2555, 2900, 3250], bw: [50, 274, 353, 195, 210] },
					{ freq: [626, 2352, 2868, 3900, 4950], bw: [51, 318, 117, 195, 210] }
				],
				contour: [
					[
						-1, -1, -1, -1.5, -1, 1, 1, 1, 2, 2, -2, -0.5, -2.5, 2, 5, 4.5, 0, 4, 4.5, -3.5, -3,
						-2.5, -2.5, -2.5, -2.5
					],
					[
						0, 0, 0.5, 0.5, 1.5, 3.5, 3, 0, -1.5, 2, 0, 4, 0.5, -2.5, -3, 0, -0.5, 0.5, -2, 2, -0.5,
						-1, -2.5, -2.5, -2.5
					],
					[
						0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0, 0.5, 2, 2, 4, 4.5, 1.5, -1.5, -3, -1, -1.5, -3.5,
						3.5, -1.5, -2.5, -2, -2, -2
					]
				]
			},
			u: {
				vowel: 'fitted',
				sung: [1, 1, 1],
				measured: [],
				registers: [
					{ freq: [365, 867, 2318, 2450, 2750], bw: [399, 206, 107, 180, 195] },
					{ freq: [405, 770, 2575, 2900, 3250], bw: [395, 208, 353, 195, 210] },
					{ freq: [592, 999, 3074, 3900, 4950], bw: [339, 41, 388, 195, 210] }
				],
				contour: [
					[
						-1, -1, -1, -1, -2, -1.5, -1, 0.5, 0.5, -0.5, -4, -0.5, 2, 0, 2, 2, 4, 4.5, -0.5, -3,
						-1.5, -0.5, 0.5, 1, 1
					],
					[
						-1, -1, -1.5, -1.5, -1.5, -0.5, -0.5, 0.5, -1, 1, 0, -1, -0.5, 1.5, -3, -6.5, -2.5, 0.5,
						-0.5, 3, 3.5, 3, 3.5, 3, 3
					],
					[
						-1, -1, -1, -1, -1, -1, -1.5, -1.5, -2, 0, 1.5, 0.5, 0.5, 2.5, 2.5, -0.5, -1.5, 0.5,
						-1.5, -2, 0, 2.5, 2.5, 2, 2
					]
				]
			}
		},
		contour: [
			[
				-25.5, -25.5, -26, -26.5, -25, -18.5, -15, -13.5, -6.5, 0, -11, -29, -27.5, -24, -37.5,
				-45.5, -37.5, -25.5, -9, -22.5, -19, -14.5, -15, -16.5, -17
			],
			[
				-23.5, -24, -23.5, -24, -23, -19.5, -18, -16, -9, -1.5, -9.5, -23.5, -23, -12.5, -17.5, -32,
				-37, -25, -13.5, -29, -35, -26.5, -25.5, -21.5, -21.5
			],
			[
				-22, -21.5, -21, -20.5, -19.5, -18, -16.5, -15, -12.5, -9.5, -11, -18.5, -23.5, -14, -7.5,
				-16, -32, -27.5, -22, -27, -35, -32, -31, -29.5, -29
			]
		],
		vibrato: { ...MS_BASIC_AAHS.vibrato, rate: 6, depth: 12 }
	}),
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
		vowel: { amount: 0.2, width: 3 },
		selected: 'o',
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

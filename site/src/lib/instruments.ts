/**
 * The instruments that a vocal part can be played with instead of its own, as General MIDI
 * programs. site/scripts/soundfont.ts writes their soundfont files, except for those of OWN_PROGRAMS.
 */
export const INSTRUMENTS: [program: number, label: string][] = [
	[52, 'Choir Aahs'],
	[53, 'Voice Oohs'],
	[54, 'Practice Synth'],
	[91, 'Choir Vowels'],
	[75, 'Pan Flute'],
	[73, 'Flute'],
	[71, 'Clarinet'],
	[68, 'Oboe'],
	[0, 'Piano'],
	[19, 'Church Organ']
];

/** The General MIDI program of the metronome's clicks: Woodblock. */
export const METRONOME = 115;

/**
 * The programs whose soundfont file in media/soundfont/ is not cut from MS Basic but checked in as
 * it is: 54, Practice Synth, is a synthesized voice made for this page, and 91, Choir Vowels, a
 * choir with a preset per vowel, the soundfont designer's Recorded Choir.
 */
export const OWN_PROGRAMS = new Set([54, 91]);

/** The soundfont file of a General MIDI program, in the soundfont/ directory of the media. */
export const soundfontFile = (program: number) => `${program}.sf3`;

/**
 * The programs with a preset per vowel, whose formant table (see formants.ts) is beside their
 * soundfont file, in formantFile(): the soundfont designer's export writes it.
 */
export const FORMANT_PROGRAMS = [91];
export const formantFile = (program: number) => `${program}.json`;

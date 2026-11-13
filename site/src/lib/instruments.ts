/**
 * The instruments that a vocal part can be played with instead of its own, as General MIDI
 * programs. site/scripts/soundfont.ts writes their soundfont files, except for those of OWN_PROGRAMS.
 */
export const INSTRUMENTS: [program: number, label: string][] = [
	[52, 'Choir Aahs'],
	[53, 'Voice Oohs'],
	[54, 'Practice Synth'],
	[75, 'Pan Flute'],
	[73, 'Flute'],
	[71, 'Clarinet'],
	[68, 'Oboe'],
	[0, 'Piano'],
	[19, 'Church Organ']
];

/**
 * The programs whose soundfont file in media/soundfont/ is not cut from MS Basic but checked in as
 * it is: 54, Practice Synth, is a synthesized voice made for this page.
 */
export const OWN_PROGRAMS = new Set([54]);

/** The soundfont file of a General MIDI program, in the soundfont/ directory of the media. */
export const soundfontFile = (program: number) => `${program}.sf3`;

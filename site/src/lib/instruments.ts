/**
 * The instruments that a vocal part can be played with instead of its own, as General MIDI
 * programs. site/scripts/soundfont.ts writes their soundfont files.
 */
export const INSTRUMENTS: [program: number, label: string][] = [
	[52, 'Choir Aahs'],
	[53, 'Voice Oohs'],
	[75, 'Pan Flute'],
	[73, 'Flute'],
	[71, 'Clarinet'],
	[68, 'Oboe'],
	[0, 'Piano'],
	[19, 'Church Organ']
];

/** The soundfont file of a General MIDI program, in the soundfont/ directory of the media. */
export const soundfontFile = (program: number) => `${program}.sf3`;

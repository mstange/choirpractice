// The shape of piece.json, as written by tools/extract.py.
export interface Syllable {
	t0: number;
	t1: number;
	text: string;
	/** MusicXML syllabic: single, begin, middle, end. */
	syl: 's' | 'b' | 'm' | 'e';
}

export interface Note {
	t0: number;
	t1: number;
	/** MIDI pitch. */
	p: number;
	/** Index of the syllable this note belongs to. */
	s: number;
}

export interface Voice {
	name: string;
	syllables: Syllable[];
	notes: Note[];
}

export interface Part {
	name: string;
	vocal: boolean;
	/** Directory of the stem's chunks: <file>/<k>.mp3. */
	file: string;
}

/** How the stems are chunked; see tools/encode_stems.py. */
export interface AudioInfo {
	rate: number;
	/** Length of every stem, in samples. */
	length: number;
	/** Samples per chunk. */
	chunk: number;
	/** Samples of the neighbouring chunks encoded on either side of each chunk. */
	pad: number;
}

/** One line of sheet music with some parts shown; see tools/engrave.py. */
export interface Engraving {
	parts: string[];
	/** The SVG, sized in its own units. */
	file: string;
	width: number;
	height: number;
	/** The distance between staff lines. */
	spatium: number;
	/** Time and x position of every chord or rest of the shown parts, both increasing. */
	t: number[];
	x: number[];
}

export interface PieceData {
	title: string;
	subtitle: string;
	credits: string;
	parts: Part[];
	voices: Voice[];
	/** Start time of each measure, plus the end time of the last one. */
	measures: number[];
	audio: AudioInfo;
	engravings: Engraving[];
}

/** An entry of pieces.json. */
export interface PieceEntry {
	slug: string;
	label: string;
	hues?: [string, number][];
}

export type View = 'overlay' | 'lanes' | 'lines';

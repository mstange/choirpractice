// The Choral Singing Dataset's Locus iste, for the scripts in this directory: where it is, and its
// recordings and pitch tracks. See README.md here.
import { readFileSync } from 'node:fs';

export const root = new URL('../../../', import.meta.url).pathname,
	/** The dataset's version 5, unpacked, which has the pitch tracks and note annotations. */
	csd = process.env.CSD ?? `${root}.dev/choir/csd5/ChoralSingingDataset`,
	/** The aligned notes that align.ts writes. */
	notesPath = `${root}.dev/choir/notes.json`;

export const SECTIONS = ['soprano', 'alto', 'tenor', 'bass'];

/** A recorded note: start and length in seconds, mean f0, the score's key, and its vowel. */
export type Note = {
	t: number;
	d: number;
	f0: number;
	key: number;
	v: string | null;
	first: boolean;
};

export const readNotes = (): Record<string, Note[]> => JSON.parse(readFileSync(notesPath, 'utf8'));

/** A mono 32- or 64-bit float WAV file's samples and rate. */
function readWav(path: string) {
	const b = readFileSync(path);
	let i = 12,
		rate = 0,
		bits = 0;
	while (i < b.length) {
		const id = b.toString('ascii', i, i + 4),
			size = b.readUInt32LE(i + 4);
		if (id === 'fmt ') {
			if (b.readUInt16LE(i + 8) !== 3 || b.readUInt16LE(i + 10) !== 1)
				throw new Error(`${path}: not mono float`);
			rate = b.readUInt32LE(i + 12);
			bits = b.readUInt16LE(i + 22);
		} else if (id === 'data') {
			const bytes = bits / 8,
				x = new Float32Array(size / bytes);
			for (let k = 0; k < x.length; k++)
				x[k] = bytes === 8 ? b.readDoubleLE(i + 8 + 8 * k) : b.readFloatLE(i + 8 + 4 * k);
			return { x, rate };
		}
		i += 8 + size + (size & 1);
	}
	throw new Error(`${path}: no data`);
}

/** A section's four microphones mixed, as one recording of the section. */
export function sectionMix(section: string) {
	const singers = [1, 2, 3, 4].map((k) => readWav(`${csd}/CSD_LI_${section}_${k}.wav`)),
		len = Math.min(...singers.map((s) => s.x.length)),
		mix = new Float32Array(len);
	for (const s of singers) for (let i = 0; i < len; i++) mix[i] += s.x[i];
	return { mix, rate: singers[0].rate };
}

/** Each singer's f0 track of a section: Hz every `hop` seconds, 0 where unvoiced. */
export const sectionF0 = (section: string) =>
	[1, 2, 3, 4].map((k) => {
		const rows = readFileSync(`${csd}/CSD_LI_${section}_${k}.f0`, 'utf8')
			.trim()
			.split('\n')
			.map((l) => l.trim().split(/\s+/).map(Number));
		return { hop: rows[1][0] - rows[0][0], hz: Float64Array.from(rows, (r) => r[1]) };
	});

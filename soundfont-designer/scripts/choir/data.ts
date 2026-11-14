// The Choral Singing Dataset's Locus iste, for the scripts in this directory: where it is, and its
// recordings and pitch tracks. See README.md here.
import { readFileSync } from 'node:fs';
import { ifft } from '../../src/lib/dsp.ts';

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
	text: string;
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

const N = 4096,
	HOP = 1024,
	TOP = 10000;
const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];

/**
 * The power of each harmonic of `x` below 10 kHz from `from` to `to` seconds, and of the noise
 * beside it, summed over windows of 4096 samples, each at the pitch that `f0At` gives for its
 * middle (none: left out), as measure.ts measures a rendered note: within ±1/4 of the fundamental,
 * less the median bin in the middle half between it and the next harmonic.
 */
export function harmonicPowers(
	x: Float32Array,
	rate: number,
	from: number,
	to: number,
	f0At: (t: number) => number | null
) {
	const level: number[] = [],
		noise: number[] = [],
		bin = rate / N;
	for (let s = Math.round(from * rate); s + N <= Math.round(to * rate); s += HOP) {
		const f0 = f0At((s + N / 2) / rate);
		if (!f0) continue;
		const re = new Float64Array(N),
			im = new Float64Array(N);
		for (let i = 0; i < N; i++) re[i] = x[s + i] * win[i];
		ifft(re, im);
		const power = (k: number) => re[k] ** 2 + im[k] ** 2;
		for (let h = 1; (h + 0.75) * f0 < TOP; h++) {
			const lo = Math.round(((h - 0.25) * f0) / bin),
				hi = Math.round(((h + 0.25) * f0) / bin),
				gap = [];
			for (let k = hi; k <= Math.round(((h + 0.75) * f0) / bin); k++) gap.push(power(k));
			const floor = median(gap);
			let sum = 0;
			for (let k = lo; k <= hi; k++) sum += Math.max(0, power(k) - floor);
			level[h - 1] = (level[h - 1] ?? 0) + sum;
			noise[h - 1] = (noise[h - 1] ?? 0) + floor * (hi - lo + 1);
		}
	}
	return { level, noise };
}

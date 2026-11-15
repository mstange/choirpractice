// Moves what the vowels of all voices have in common in their own contours into the patch's
// contour: the mean of their own contours, which is added to the patch's and taken from every
// vowel's own, of all voices and of each voice type. Every vowel's tone stays the same, and the
// patch's contour becomes the part of the timbre that doesn't change with the vowel.
//
// Usage: node scripts/choir/share-contour.ts patch.json out.json
import { readFileSync, writeFileSync } from 'node:fs';
import { complete, type VowelFormants } from '../../src/lib/patch.ts';

const p = complete(JSON.parse(readFileSync(process.argv[2], 'utf8'))),
	own = Object.values(p.vowels).flatMap((f) => (f.contour ? [f.contour] : []));
if (!own.length) throw new Error('no vowel of all voices has a contour of its own');
const mean = p.contour.map((row, g) =>
	row.map((_, j) => Math.round((own.reduce((s, c) => s + c[g][j], 0) / own.length) * 2) / 2)
);
p.contour = p.contour.map((row, g) => row.map((v, j) => v + mean[g][j]));
const take = (f: VowelFormants) =>
	(f.contour = mean.map((row, g) => row.map((m, j) => (f.contour?.[g][j] ?? 0) - m)));
Object.values(p.vowels).forEach(take);
for (const set of Object.values(p.voices)) Object.values(set).forEach(take);
console.log(
	`moved into the contour, per register, mean and range in dB: ${mean
		.map((row) => {
			const m = row.reduce((s, v) => s + v, 0) / row.length;
			return `${m.toFixed(1)} (${Math.min(...row)} to ${Math.max(...row)})`;
		})
		.join(', ')}`
);
writeFileSync(process.argv[3], JSON.stringify(p, null, 1));

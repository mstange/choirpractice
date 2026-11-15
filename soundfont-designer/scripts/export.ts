// Exports a patch as the page's Export SF3 does: every vowel's preset at `program`, its samples
// compressed to Ogg Vorbis, and beside it, as out.json, the formants of its vowels (see
// formantTable()), with which the choir app slides from one vowel to another.
//
// Usage: node scripts/export.ts [preset or patch JSON] program out.sf3
// With --formants, it writes only out.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildBank } from '../src/lib/build.ts';
import { complete, type Patch } from '../src/lib/patch.ts';
import { STARTING_POINTS } from '../src/lib/presets.ts';
import { formantTable, hasFormants } from '../src/lib/vowel.ts';
import { compress } from '../src/lib/vorbis.ts';

const formantsOnly = process.argv.includes('--formants');
const [which, program, out] = process.argv.slice(2).filter((a) => a !== '--formants');
const patch: Patch = which.endsWith('.json')
	? complete(JSON.parse(readFileSync(which, 'utf8')))
	: structuredClone(STARTING_POINTS.find((p) => p.name === which)!);
if (formantsOnly || hasFormants(patch))
	writeFileSync(out.replace(/\.sf[23]$/, '.json'), JSON.stringify(formantTable(patch)) + '\n');
if (formantsOnly) process.exit(0);
const { bank, clipped } = buildBank(patch, +program, { set: true });
if (clipped.length) console.log(`too loud on the zones of ${clipped.join(', ')}`);
await compress(bank);
const file = bank.writeSF2({ writeDefaultModulators: true });
writeFileSync(out, new Uint8Array(file));
console.log(
	`${out}: ${bank.presets.length} presets, ${bank.samples.length} samples, ${(file.byteLength / 1e6).toFixed(1)} MB`
);

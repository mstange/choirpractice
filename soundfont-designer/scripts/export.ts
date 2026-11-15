// Exports a patch as the page's Export SF3 does: every vowel's preset at `program`, its samples
// compressed to Ogg Vorbis.
//
// Usage: node scripts/export.ts [preset or patch JSON] program out.sf3
import { readFileSync, writeFileSync } from 'node:fs';
import { buildBank } from '../src/lib/build.ts';
import { complete, type Patch } from '../src/lib/patch.ts';
import { STARTING_POINTS } from '../src/lib/presets.ts';
import { compress } from '../src/lib/vorbis.ts';

const [which, program, out] = process.argv.slice(2);
const patch: Patch = which.endsWith('.json')
	? complete(JSON.parse(readFileSync(which, 'utf8')))
	: structuredClone(STARTING_POINTS.find((p) => p.name === which)!);
const { bank, clipped } = buildBank(patch, +program, { set: true });
if (clipped.length) console.log(`too loud on the zones of ${clipped.join(', ')}`);
await compress(bank);
const file = bank.writeSF2({ writeDefaultModulators: true });
writeFileSync(out, new Uint8Array(file));
console.log(
	`${out}: ${bank.presets.length} presets, ${bank.samples.length} samples, ${(file.byteLength / 1e6).toFixed(1)} MB`
);

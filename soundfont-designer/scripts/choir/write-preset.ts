// Writes what Recorded Choir (src/lib/presets.ts) has of a patch fitted with these scripts into
// src/lib/recorded-choir.ts: its registers, noise between the harmonics, contour and vowels.
//
// Usage: node scripts/choir/write-preset.ts patch.json
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { complete } from '../../src/lib/patch.ts';

const p = complete(JSON.parse(readFileSync(process.argv[2], 'utf8'))),
	path = new URL('../../src/lib/recorded-choir.ts', import.meta.url).pathname;
const fitted = {
	registerKeys: p.registerKeys,
	aperiodic: p.tone.aperiodic,
	aperiodicTilt: p.tone.aperiodicTilt,
	contour: p.contour,
	vowels: p.vowels
};
writeFileSync(
	path,
	`// What Recorded Choir (presets.ts) has fitted to the recorded choir, as written by
// scripts/choir/write-preset.ts from the scripts' fits (see scripts/choir/README.md).
import type { Patch } from './patch.ts';

export const RECORDED_CHOIR: Pick<Patch, 'registerKeys' | 'contour' | 'vowels'> &
	Pick<Patch['tone'], 'aperiodic' | 'aperiodicTilt'> = ${JSON.stringify(fitted)};
`
);
execFileSync('npx', ['prettier', '--write', path], {
	stdio: 'inherit',
	cwd: new URL('../..', import.meta.url).pathname
});

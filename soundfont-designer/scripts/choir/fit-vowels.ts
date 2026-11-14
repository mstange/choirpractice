// Fits each vowel of a patch to the recorded choir's notes on it, by what the patch plays: per
// register of CONTOUR_KEYS, F1 to F3 and their bandwidths, searched with the harmonics predicted
// from the patch's spectrum (predict.ts), and then, optionally, a contour of the vowel's own.
// Tests each fit on the notes that it wasn't fitted on, and the final one by rendering.
//
// Usage: node scripts/choir/fit-vowels.ts [preset or patch JSON, default Recorded Choir]
//   [vowels, default ɛ i ɔ u] [--contour] [--section soprano|alto|tenor|bass] [--write patch.json]
// With --section, fitted to that section's notes only, as that voice type's own vowels, from those
// that it has or else those of all voices.
import { readFileSync, writeFileSync } from 'node:fs';
import { BasicSoundBank } from 'spessasynth_core';
import { fitContour, measure, patchBank, type Harmonic } from '../../src/lib/measure.ts';
import { complete, type Formants, type Patch, type VowelFormants } from '../../src/lib/patch.ts';
import { STARTING_POINTS } from '../../src/lib/presets.ts';
import { registerFormants, selectedFormants } from '../../src/lib/vowel.ts';
import { choirHarmonics, harmonicsOf, type KeyHarmonics } from './data.ts';
import { misfit, predict } from './predict.ts';

const args = process.argv.slice(2),
	flag = (name: string) => {
		const i = args.indexOf(name);
		return i >= 0 ? args.splice(i, 1).length > 0 : false;
	},
	option = (name: string) => {
		const i = args.indexOf(name);
		return i >= 0 ? args.splice(i, 2)[1] : null;
	};
const withContour = flag('--contour'),
	section = option('--section'),
	writeTo = option('--write'),
	[which = 'Recorded Choir', ...listed] = args,
	vowels = listed.length ? listed : ['ɛ', 'i', 'ɔ', 'u'];
const patch: Patch = which.endsWith('.json')
	? complete(JSON.parse(readFileSync(which, 'utf8')))
	: structuredClone(STARTING_POINTS.find((p) => p.name === which)!);
// With a section, its vowels are the voice type's own, and the patch plays them.
const voice = section as Patch['voice'];
patch.voice = voice;

const round = (r: Formants[]) =>
	r.map(({ freq, bw }) => ({ freq: freq.map(Math.round), bw: bw.map(Math.round) }));

/**
 * Whether formants are in order, F1 to F4, and within a voice's reach, with bandwidths that a
 * section's formants may have: narrower ones fitted a spike onto one harmonic.
 */
const valid = (r: Formants[]) =>
	r.every(
		({ freq, bw }) =>
			freq[0] >= 150 &&
			freq[0] <= 1200 &&
			[1, 2, 3].every((i) => freq[i] > freq[i - 1] * 1.05) &&
			bw.slice(0, 3).every((w) => w >= 40 && w <= 400)
	);

/**
 * The formants per register that bring the patch's predicted harmonics nearest the choir's, from
 * `start`: a search moving one value at a time, F1 to F3 and their bandwidths in each register,
 * by ever smaller ratios.
 */
function search(start: Formants[], entries: Harmonic[][], keys: number[], base: VowelFormants) {
	const error = (r: Formants[]) => {
		const f: VowelFormants = { ...base, vowel: 'fitted', registers: r };
		return misfit(
			entries,
			keys.map((k) => predict(patch, k, f))
		).rms;
	};
	let best = start,
		e = error(best);
	for (const [fs, bs] of [
		[1.12, 1.4],
		[1.06, 1.2],
		[1.03, 1.1],
		[1.015, 1.05]
	])
		for (let improved = true; improved;) {
			improved = false;
			for (let g = 0; g < best.length; g++)
				for (const what of ['freq', 'bw'] as const)
					for (let i = 0; i < 3; i++)
						for (const r of what === 'freq' ? [fs, 1 / fs] : [bs, 1 / bs]) {
							const tried = structuredClone(best);
							tried[g][what][i] *= r;
							if (!valid(tried)) continue;
							const te = error(tried);
							if (te < e - 1e-4) [best, e, improved] = [tried, te, true];
						}
		}
	return { registers: round(best), error: e };
}

/** The fitted vowel, with its own contour if asked for, fitted to `entries`. */
function fit(entries: Harmonic[][], keys: number[], base: VowelFormants): VowelFormants {
	const start = registerFormants(base, patch.vowel.width);
	const { registers } = search(start, entries, keys, base);
	const fitted: VowelFormants = { ...base, vowel: 'fitted', registers, contour: undefined };
	if (!withContour) return fitted;
	const { change } = fitContour(
		entries,
		keys.map((k) => predict(patch, k, fitted)),
		keys
	);
	return { ...fitted, contour: change.map((row) => row.map((v) => Math.round(v * 2) / 2)) };
}

const err = (entries: Harmonic[][], keys: number[], f: VowelFormants) =>
	misfit(
		entries,
		keys.map((k) => predict(patch, k, f))
	).rms;

await BasicSoundBank.ready;
for (const vowel of vowels) {
	patch.selected = vowel as Patch['selected'];
	const base = selectedFormants(patch),
		list: KeyHarmonics[] = choirHarmonics(vowel).filter((e) => !section || e.section === section),
		keys = list.map((e) => e.key),
		all = list.map(harmonicsOf);
	console.log(`\n${vowel}: ${list.length} section-keys`);

	// Fitted on every other note of each key with two or more, measured on the others.
	const split = list.flatMap((e, i) => (e.halves[1].notes ? [i] : [])),
		splitKeys = split.map((i) => keys[i]),
		halves = [0, 1].map((h) => split.map((i) => harmonicsOf(list[i].halves[h])));
	for (const h of [0, 1]) {
		const f = fit(halves[h], splitKeys, base);
		console.log(
			`  fitted on half ${h} (${split.length} keys): ${err(halves[h], splitKeys, f).toFixed(1)} dB on it, ` +
				`${err(halves[1 - h], splitKeys, f).toFixed(1)} on the other half, where the patch is ${err(halves[1 - h], splitKeys, base).toFixed(1)}`
		);
	}
	console.log(
		`  the two halves against each other: ${misfit(halves[0], halves[1]).rms.toFixed(1)} dB`
	);

	// Fitted on all of them, and measured by rendering.
	const f = fit(all, keys, base),
		before = patchBank(patch),
		renderedBefore = keys.map((k) => measure(before, 0, k));
	if (voice) (patch.voices[voice] ??= {})[vowel as Patch['selected']] = f;
	else patch.vowels[vowel as Patch['selected']] = f;
	const after = patchBank(patch),
		renderedAfter = keys.map((k) => measure(after, 0, k));
	console.log(
		`  fitted on all: predicted ${err(all, keys, base).toFixed(1)} → ${err(all, keys, f).toFixed(1)} dB, ` +
			`rendered ${misfit(all, renderedBefore).rms.toFixed(1)} → ${misfit(all, renderedAfter).rms.toFixed(1)} dB`
	);
	const before0 = registerFormants(base, patch.vowel.width);
	f.registers!.forEach((r, g) =>
		console.log(
			`    register ${g}: F ${r.freq.slice(0, 3).join('/')} Hz (was ${before0[g].freq.slice(0, 3).map(Math.round).join('/')}), ` +
				`B ${r.bw.slice(0, 3).join('/')} Hz (was ${before0[g].bw.slice(0, 3).map(Math.round).join('/')})`
		)
	);
	if (f.contour)
		console.log(
			`    contour: ${f.contour.map((row) => row.map((v) => v.toFixed(0)).join(' ')).join(' | ')}`
		);
}
if (writeTo) writeFileSync(writeTo, JSON.stringify({ ...patch, voice: null }, null, 1));

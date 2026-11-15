// Measures the Choral Singing Dataset's Locus iste, per section (its four close microphones
// mixed), on the notes sung on one vowel: each harmonic's level and the noise beside it, per key,
// as measure.ts measures a rendered note, and the ensemble: how far apart the singers are, and
// their vibrato. Then fits MS Basic Aahs's contour to the choir, and compares Choir Aahs.
//
// Usage: node scripts/choir/analyze.ts [vowel, default a] [--base patch.json] [--write patch.json]
// With --base, the patch to fit instead of MS Basic Aahs.
import { readFileSync, writeFileSync } from 'node:fs';
import { BasicSoundBank, SoundBankLoader } from 'spessasynth_core';
import { keyFreq, keyWeights } from '../../src/lib/dsp.ts';
import { db, fitContour, measure, patchBank, solve, type Harmonic } from '../../src/lib/measure.ts';
import { complete } from '../../src/lib/patch.ts';
import { MS_BASIC_AAHS } from '../../src/lib/presets.ts';
import {
	MIN_LEFT,
	SECTIONS,
	SKIP_END,
	SKIP_START,
	choirHarmonics,
	harmonicsOf,
	readNotes,
	root,
	sectionF0
} from './data.ts';

const notes = readNotes();
const args = process.argv.slice(2),
	vowel = args[0] && !args[0].startsWith('--') ? args[0] : 'a',
	writeTo = args.includes('--write') ? args[args.indexOf('--write') + 1] : null;

const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

type Vibrato = { rate: number; depth: number };
const ensemble: Record<
	string,
	{ spread: number[]; range: number[]; vib: Vibrato[]; meanVib: Vibrato[] }
> = {};

/**
 * The vibrato of a pitch track in cents, every `hop` seconds: less its moving average over 0.3 s,
 * its rate from the zero crossings, its depth the peak (rms times √2), if it is voiced
 * throughout and long enough.
 */
function vibrato(c: number[], hop: number): Vibrato | null {
	if (c.some(Number.isNaN)) return null;
	const w = Math.round(0.15 / hop),
		dev: number[] = [];
	for (let i = w; i < c.length - w; i++) dev.push(c[i] - mean(c.slice(i - w, i + w + 1)));
	if (dev.length * hop < 0.5) return null;
	let crossings = 0;
	for (let i = 1; i < dev.length; i++) if (dev[i - 1] < 0 !== dev[i] < 0) crossings++;
	return {
		rate: crossings / 2 / (dev.length * hop),
		depth: Math.sqrt(2 * mean(dev.map((v) => v * v)))
	};
}
for (const section of SECTIONS) {
	const f0s = sectionF0(section);
	/** Each singer's f0 at `t`, in Hz, 0 where unvoiced. */
	const pitches = (t: number) => f0s.map(({ hop, hz }) => hz[Math.round(t / hop)] ?? 0);
	const ens: (typeof ensemble)[string] = (ensemble[section] = {
		spread: [],
		range: [],
		vib: [],
		meanVib: []
	});

	for (const note of notes[section].filter((n) => n.v === vowel)) {
		const from = note.t + SKIP_START,
			to = note.t + note.d - SKIP_END;
		if (to - from < MIN_LEFT) continue;
		// Ensemble: per f0 frame where all four sing, the singers' spread around their mean.
		const { hop } = f0s[0];
		for (let t = from; t < to; t += hop) {
			const p = pitches(t);
			if (p.some((f) => !f)) continue;
			const cents = p.map((f) => 1200 * Math.log2(f / note.f0)),
				m = mean(cents);
			ens.spread.push(Math.sqrt(mean(cents.map((c) => (c - m) ** 2))));
			ens.range.push(Math.max(...cents) - Math.min(...cents));
		}
		// Vibrato, on notes of at least 1 s: of each singer, and of the singers' mean pitch, which
		// the patch's one LFO for all its copies stands for.
		if (to - from >= 1) {
			const { hop } = f0s[0],
				a = Math.ceil(from / hop),
				b = Math.floor(to / hop),
				tracks = f0s.map(({ hz }) => {
					const c: number[] = [];
					for (let i = a; i < b; i++) c.push(hz[i] ? 1200 * Math.log2(hz[i] / note.f0) : NaN);
					return c;
				});
			for (const c of tracks) {
				const v = vibrato(c, hop);
				if (v) ens.vib.push(v);
			}
			const v = vibrato(
				tracks[0].map((_, i) => mean(tracks.map((c) => c[i]))),
				hop
			);
			if (v) ens.meanVib.push(v);
		}
	}
}

console.log(`vowel ${vowel}: ensemble per section (over the vowel's notes)`);
for (const [section, e] of Object.entries(ensemble)) {
	const rates = e.vib.map((v) => v.rate),
		depths = e.vib.map((v) => v.depth);
	console.log(
		`  ${section.padEnd(7)} singers' spread around their mean (rms): median ${median(e.spread).toFixed(0)} cents; ` +
			`farthest two: median ${median(e.range).toFixed(0)}, 90% ${[...e.range].sort((a, b) => a - b)[Math.floor(e.range.length * 0.9)].toFixed(0)} cents; ` +
			`vibrato (${e.vib.length} singer-notes): rate ${median(rates).toFixed(1)} Hz, depth ${median(depths).toFixed(0)} cents (median); ` +
			`of their mean pitch (${e.meanVib.length} notes): rate ${median(e.meanVib.map((v) => v.rate)).toFixed(1)} Hz, depth ${median(e.meanVib.map((v) => v.depth)).toFixed(0)} cents`
	);
}

const entries = choirHarmonics(vowel, notes).map((e) => [`${e.section} ${e.key}`, e] as const);
console.log(
	`\n${entries.length} section-keys: ${entries.map(([k, e]) => `${k} (${e.notes})`).join(', ')}`
);
const theirs = entries.map(([, e]) => harmonicsOf(e));
const keys = entries.map(([, e]) => e.key);

await BasicSoundBank.ready;
const aahs = SoundBankLoader.fromArrayBuffer(
	readFileSync(`${root}media/soundfont/52.sf3`).buffer as ArrayBuffer
);
const cache = new Map<string, Harmonic[]>();
const measured = (bank: BasicSoundBank, program: number, name: string) =>
	keys.map((key) => {
		const k = `${name} ${key}`;
		if (!cache.has(k)) cache.set(k, measure(bank, program, key));
		return cache.get(k)!;
	});

const basePath = args.includes('--base') ? args[args.indexOf('--base') + 1] : null,
	patch = basePath
		? complete(JSON.parse(readFileSync(basePath, 'utf8')))
		: structuredClone(MS_BASIC_AAHS);
patch.selected = vowel as typeof patch.selected;
const ours = measured(patchBank(patch), 0, 'patch'),
	choirAahs = measured(aahs, 52, 'aahs');
const vsAahs = fitContour(theirs, choirAahs, keys),
	fit = fitContour(theirs, ours, keys, patch.registerKeys);
const raw = patch.contour.map((row, g) => row.map((v, j) => v + fit.change[g][j])),
	top = Math.max(...raw.flat());
patch.contour = raw.map((row) => row.map((v) => Math.max(-60, Math.round((v - top) * 2) / 2)));
patch.name = `Choir (CSD) ${vowel}`;
// The noise between the harmonics: the patch's aperiodic noise has a level and a tilt per octave
// of frequency from 1 kHz per register, and those of the registers on either side in between, so
// the change that brings the patch's noise against its harmonics nearest the choir's is a linear
// regression of their difference, over the harmonics up to 5 kHz within 40 dB of each key's
// strongest, with a little of the change's own size, which holds a register without notes near it.
{
	const fitted = measured(patchBank(patch), 0, 'contour'),
		regs = patch.registerKeys,
		m = 2 * regs.length,
		rows: { terms: [number, number][]; e: number }[] = [];
	keys.forEach((key, k) => {
		const top = Math.max(...theirs[k].map((h) => h.level)),
			[a, b, t] = keyWeights(regs, key, true);
		theirs[k].forEach((h, i) => {
			const o = fitted[k][i],
				f = (i + 1) * keyFreq(key),
				x = Math.log2(f / 1000);
			if (!o || f > 5000 || db(h.level / top) < -40) return;
			rows.push({
				terms: [
					[2 * a, 1 - t],
					[2 * a + 1, (1 - t) * x],
					[2 * b, t],
					[2 * b + 1, t * x]
				],
				e: db(h.noise / h.level) - db(o.noise / o.level)
			});
		});
	});
	const ata = Array.from({ length: m }, () => new Float64Array(m)),
		atb = new Float64Array(m);
	for (const { terms, e } of rows)
		for (const [p, wp] of terms) {
			atb[p] += wp * e;
			for (const [q, wq] of terms) ata[p][q] += wp * wq;
		}
	for (let p = 0; p < m; p++) ata[p][p] += 0.1;
	const x = solve(ata, atb);
	const rmsOf = (f: (r: (typeof rows)[0]) => number) =>
		Math.sqrt(rows.reduce((s, r) => s + f(r) ** 2, 0) / rows.length);
	console.log(
		`\nnoise against the harmonics, choir minus patch, over ${rows.length} harmonics: ${rmsOf((r) => r.e).toFixed(1)} dB rms, ` +
			`${rmsOf((r) => r.e - r.terms.reduce((s, [p, w]) => s + w * x[p], 0)).toFixed(1)} after the change`
	);
	regs.forEach((key, g) => {
		patch.tone.aperiodic[g] = Math.round((patch.tone.aperiodic[g] + x[2 * g]) * 10) / 10;
		patch.tone.aperiodicTilt[g] =
			Math.round((patch.tone.aperiodicTilt[g] + x[2 * g + 1]) * 10) / 10;
		console.log(
			`  on ${key}: aperiodic ${patch.tone.aperiodic[g]} dB (${x[2 * g] >= 0 ? '+' : ''}${x[2 * g].toFixed(1)}), ` +
				`tilt ${patch.tone.aperiodicTilt[g]} dB per octave (${x[2 * g + 1] >= 0 ? '+' : ''}${x[2 * g + 1].toFixed(1)})`
		);
	});
	const after = measured(patchBank(patch), 0, 'noise');
	const again: number[] = [];
	keys.forEach((key, k) => {
		const top = Math.max(...theirs[k].map((h) => h.level));
		theirs[k].forEach((h, i) => {
			const o = after[k][i],
				f = (i + 1) * keyFreq(key);
			if (!o || f > 5000 || db(h.level / top) < -40) return;
			again.push(db(h.noise / h.level) - db(o.noise / o.level));
		});
	});
	console.log(
		`  measured again: ${Math.sqrt(again.reduce((s, v) => s + v * v, 0) / again.length).toFixed(1)} dB rms, mean ${(again.reduce((s, v) => s + v, 0) / again.length).toFixed(1)}`
	);
}
const again = fitContour(theirs, measured(patchBank(patch), 0, 'fitted'), keys);

console.log(
	`\nharmonic levels against the choir's, dB rms (with the best offset per key):\n` +
		`  MS Basic Choir Aahs: ${vsAahs.before.toFixed(1)}\n` +
		`  the patch: ${fit.before.toFixed(1)}; its contour fitted: ${fit.after.toFixed(1)} as fitted, ${again.before.toFixed(1)} measured again`
);
console.log('  per key (Choir Aahs / patch / fitted):');
entries.forEach(([k], i) => {
	const one = (h: Harmonic[]) => fitContour([theirs[i]], [h], [keys[i]]).before.toFixed(1);
	console.log(
		`    ${k.padEnd(12)} ${one(choirAahs[i]).padStart(5)} ${one(ours[i]).padStart(5)} ${one(cache.get(`fitted ${keys[i]}`)!).padStart(5)}`
	);
});
console.log(
	'\nfitted contour:\n' +
		patch.contour.map((row, g) => `  at ${patch.registerKeys[g]}: ${row.join(' ')}`).join('\n')
);
// The choir's noise between harmonics, against the harmonics, per section, as the patch's
// aperiodic noise is set: at about 1 kHz.
console.log('\nnoise beside the harmonics near 1 kHz, dB against them:');
entries.forEach(([k, e], i) => {
	const h = Math.max(0, Math.round(1000 / keyFreq(e.key)) - 1),
		t = theirs[i][h],
		a = choirAahs[i][h],
		o = cache.get(`fitted ${keys[i]}`)![h];
	console.log(
		`  ${k.padEnd(12)} choir ${db(t.noise / t.level)
			.toFixed(0)
			.padStart(4)}, Choir Aahs ${db(a.noise / a.level)
			.toFixed(0)
			.padStart(4)}, fitted ${db(o.noise / o.level)
			.toFixed(0)
			.padStart(4)}`
	);
});
if (writeTo) writeFileSync(writeTo, JSON.stringify(patch, null, 1));

// Fitted on every other note of each key, measured on the others, and the other way round; and
// how far those two halves of the choir are from each other, which no fit can beat.
const split = entries.flatMap(([, e], i) => (e.halves[1].notes ? [i] : []));
const halves = [0, 1].map((h) => split.map((i) => harmonicsOf(entries[i][1].halves[h]))),
	splitKeys = split.map((i) => keys[i]);
const base = basePath
	? complete(JSON.parse(readFileSync(basePath, 'utf8')))
	: structuredClone(MS_BASIC_AAHS);
base.selected = patch.selected;
for (const h of [0, 1]) {
	const f = fitContour(
			halves[h],
			split.map((i) => ours[i]),
			splitKeys,
			base.registerKeys
		),
		p = structuredClone(base);
	p.contour = p.contour.map((row, g) => row.map((v, j) => v + f.change[g][j]));
	const bank = patchBank(p),
		fitted = splitKeys.map((key) => measure(bank, 0, key));
	console.log(
		`\nfitted on half ${h} (${split.length} keys with two notes or more): ${f.after.toFixed(1)} dB on it, ` +
			`${fitContour(halves[1 - h], fitted, splitKeys).before.toFixed(1)} on the other half, ` +
			`where the patch unfitted is ${fitContour(
				halves[1 - h],
				split.map((i) => ours[i]),
				splitKeys
			).before.toFixed(1)} ` +
			`and Choir Aahs ${fitContour(
				halves[1 - h],
				split.map((i) => choirAahs[i]),
				splitKeys
			).before.toFixed(1)}`
	);
}
// Against each other, the measure needs a reference's noise and a patch's levels: half 0 as
// the reference.
console.log(
	`the two halves of the choir against each other: ${fitContour(halves[0], halves[1], splitKeys).before.toFixed(1)} dB rms`
);

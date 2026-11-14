// Measures the Choral Singing Dataset's Locus iste, per section (its four close microphones
// mixed), on the notes sung on one vowel: each harmonic's level and the noise beside it, per key,
// as measure.ts measures a rendered note, and the ensemble: how far apart the singers are, and
// their vibrato. Then fits MS Basic Aahs's contour to the choir, and compares Choir Aahs.
//
// Usage: node scripts/choir/analyze.ts [vowel, default a] [--base patch.json] [--write patch.json]
// With --base, the patch to fit instead of MS Basic Aahs.
import { readFileSync, writeFileSync } from 'node:fs';
import { BasicSoundBank, SoundBankLoader } from 'spessasynth_core';
import { ifft, keyFreq } from '../../src/lib/dsp.ts';
import { db, fitContour, measure, patchBank, type Harmonic } from '../../src/lib/measure.ts';
import { CONTOUR_KEYS, complete } from '../../src/lib/patch.ts';
import { MS_BASIC_AAHS } from '../../src/lib/presets.ts';
import { SECTIONS, readNotes, root, sectionF0, sectionMix } from './data.ts';

const notes = readNotes();
const args = process.argv.slice(2),
	vowel = args[0] && !args[0].startsWith('--') ? args[0] : 'a',
	writeTo = args.includes('--write') ? args[args.indexOf('--write') + 1] : null;

const N = 4096,
	HOP = 1024,
	TOP = 10000,
	/** Seconds left out at a note's start (the consonant, the onset) and end. */
	SKIP_START = 0.15,
	SKIP_END = 0.1,
	MIN_LEFT = 0.3;
const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;

/**
 * Per section and key, the summed power of each harmonic and of the noise beside it, of all its
 * notes and of every other note, for testing a fit on notes that it wasn't fitted on.
 */
type Sum = { level: number[]; noise: number[]; notes: number };
const sums = new Map<string, Sum & { key: number; halves: Sum[] }>();
const add = (to: Sum, level: number[], noise: number[], total: number) => {
	level.forEach((v, h) => (to.level[h] = (to.level[h] ?? 0) + v / total));
	noise.forEach((v, h) => (to.noise[h] = (to.noise[h] ?? 0) + v / total));
	to.notes++;
};
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
	const { mix, rate } = sectionMix(section),
		f0s = sectionF0(section);
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

		// Harmonics, per frame at the singers' mean pitch, summed over the note's frames, then
		// normalized so that each note counts the same.
		const k0 = `${section} ${note.key}`,
			entry = sums.get(k0) ?? {
				key: note.key,
				level: [],
				noise: [],
				notes: 0,
				halves: [0, 1].map(() => ({ level: [], noise: [], notes: 0 }))
			};
		sums.set(k0, entry);
		const level: number[] = [],
			noise: number[] = [],
			bin = rate / N;
		for (let s = Math.round(from * rate); s + N <= Math.round(to * rate); s += HOP) {
			const p = pitches((s + N / 2) / rate).filter((f) => f);
			if (p.length < 2) continue;
			const f0 = 2 ** mean(p.map(Math.log2)),
				re = new Float64Array(N),
				im = new Float64Array(N);
			for (let i = 0; i < N; i++) re[i] = mix[s + i] * win[i];
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
		const total = level.reduce((s, v) => s + v, 0);
		if (!total) continue;
		add(entry.halves[entry.notes % 2], level, noise, total);
		add(entry, level, noise, total);
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

const entries = [...sums.entries()]
	.filter(([, e]) => e.notes > 0)
	.sort(([, a], [, b]) => a.key - b.key);
console.log(
	`\n${entries.length} section-keys: ${entries.map(([k, e]) => `${k} (${e.notes})`).join(', ')}`
);
const harmonicsOf = (e: Sum): Harmonic[] =>
	e.level.map((level, h) => ({ level, noise: e.noise[h], cents: 0 }));
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
	fit = fitContour(theirs, ours, keys);
const raw = patch.contour.map((row, g) => row.map((v, j) => v + fit.change[g][j])),
	top = Math.max(...raw.flat());
patch.contour = raw.map((row) => row.map((v) => Math.max(-60, Math.round((v - top) * 2) / 2)));
patch.name = `Choir (CSD) ${vowel}`;
// The noise between the harmonics: the patch's aperiodic noise is linear in dB in the octaves of
// key from C4 and of frequency from 1 kHz, so the change that brings the patch's noise against
// its harmonics nearest the choir's is a linear regression of their difference, over the
// harmonics up to 5 kHz within 40 dB of each key's strongest.
{
	const fitted = measured(patchBank(patch), 0, 'contour'),
		rows: number[][] = [];
	keys.forEach((key, k) => {
		const top = Math.max(...theirs[k].map((h) => h.level));
		theirs[k].forEach((h, i) => {
			const o = fitted[k][i],
				f = (i + 1) * keyFreq(key);
			if (!o || f > 5000 || db(h.level / top) < -40) return;
			rows.push([
				1,
				(key - 60) / 12,
				Math.log2(f / 1000),
				db(h.noise / h.level) - db(o.noise / o.level)
			]);
		});
	});
	// Normal equations of three unknowns.
	const ata = [0, 1, 2].map((i) => [0, 1, 2].map((j) => rows.reduce((s, r) => s + r[i] * r[j], 0))),
		atb = [0, 1, 2].map((i) => rows.reduce((s, r) => s + r[i] * r[3], 0));
	const det = (m: number[][]) =>
		m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
		m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
		m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
	const d = det(ata),
		x = [0, 1, 2].map(
			(c) => det(ata.map((row, r) => row.map((v, j) => (j === c ? atb[r] : v)))) / d
		);
	const rmsOf = (f: (r: number[]) => number) =>
		Math.sqrt(rows.reduce((s, r) => s + f(r) ** 2, 0) / rows.length);
	console.log(
		`\nnoise against the harmonics, choir minus patch, over ${rows.length} harmonics: ${rmsOf((r) => r[3]).toFixed(1)} dB rms, ` +
			`${rmsOf((r) => r[3] - x[0] - x[1] * r[1] - x[2] * r[2]).toFixed(1)} after the change: ` +
			`aperiodic ${x[0] >= 0 ? '+' : ''}${x[0].toFixed(1)}, per octave of key ${x[1].toFixed(1)}, per octave of frequency ${x[2].toFixed(1)}`
	);
	patch.tone.aperiodic = Math.round(patch.tone.aperiodic + x[0]);
	patch.tone.aperiodicSlope = Math.round(patch.tone.aperiodicSlope + x[1]);
	patch.tone.aperiodicTilt = Math.round(patch.tone.aperiodicTilt + x[2]);
	console.log(
		`  aperiodic ${patch.tone.aperiodic}, slope ${patch.tone.aperiodicSlope}, tilt ${patch.tone.aperiodicTilt}`
	);
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
		patch.contour.map((row, g) => `  at ${CONTOUR_KEYS[g]}: ${row.join(' ')}`).join('\n')
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
			splitKeys
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

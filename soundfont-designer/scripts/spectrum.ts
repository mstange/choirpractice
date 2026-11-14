// Compares the long-term spectrum of the sustain of MS Basic's Choir Aahs with a patch's, as
// spessasynth renders them: per harmonic its level, the noise between it and the next, and how
// widely it is spread, and how a strong harmonic moves over time. With --match, the patch's
// contour is first matched to Choir Aahs, as the page's Match button does.
//
// Usage: node scripts/spectrum.ts [--match] [patch name from presets.ts, or a patch's JSON file]
//   [keys, comma-separated]
import { readFileSync } from 'node:fs';
import { BasicSoundBank, SoundBankLoader } from 'spessasynth_core';
import { ifft, keyFreq } from '../src/lib/dsp.ts';
import {
	RATE,
	db,
	fitContour,
	harmonics,
	matchContour,
	measure,
	patchBank,
	peak,
	render,
	spectrum
} from '../src/lib/measure.ts';
import { CONTOUR_KEYS, MATCH_KEYS, complete } from '../src/lib/patch.ts';
import { STARTING_POINTS } from '../src/lib/presets.ts';

const soundfonts = new URL('../../choirpractice-app/media/soundfont/', import.meta.url).pathname;
const args = process.argv.slice(2),
	matching = args[0] === '--match';
if (matching) args.shift();
const arg = args[0] ?? 'Practice Voice',
	patch = arg.endsWith('.json')
		? complete(JSON.parse(readFileSync(arg, 'utf8')))
		: STARTING_POINTS.find((p) => p.name === arg)!;
const keys = args[1]?.split(',').map(Number) ?? [45, 52, 60, 67, 72];

await BasicSoundBank.ready;
const aahs = SoundBankLoader.fromArrayBuffer(
	readFileSync(`${soundfonts}52.sf3`).buffer as ArrayBuffer
);
if (matching) {
	const t = performance.now(),
		m = matchContour(aahs, 52, patch);
	patch.contour = m.contour;
	console.log(
		`matched on keys ${MATCH_KEYS.join(', ')} in ${((performance.now() - t) / 1000).toFixed(1)} s: ` +
			`${m.before.toFixed(1)} dB rms before, ${m.after.toFixed(1)} dB as fitted\n` +
			m.contour.map((row, g) => `contour at ${CONTOUR_KEYS[g]}: ${row.join(' ')}`).join('\n')
	);
}
const custom = patchBank(patch);
if (matching) {
	const after = fitContour(
		MATCH_KEYS.map((key) => measure(aahs, 52, key)),
		MATCH_KEYS.map((key) => measure(custom, 0, key)),
		MATCH_KEYS
	);
	console.log(`measured again: ${after.before.toFixed(1)} dB rms`);
}
const median = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1];

/**
 * Harmonic `h` in windows of 2^13 samples (171 ms): how far its center moves (the standard
 * deviation in cents), its spread within a window, and how much its level varies (in dB).
 */
function motion([l, r]: Float32Array[], f0: number, h: number) {
	const n = 2 ** 13,
		bin = RATE / n,
		lo = Math.round(((h - 0.4) * f0) / bin),
		hi = Math.round(((h + 0.4) * f0) / bin);
	const win = Float64Array.from(
		{ length: n },
		(_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
	);
	const centers = [],
		spreads = [],
		levels = [];
	for (let start = 0; start + n <= l.length; start += n / 4) {
		const power = new Float64Array(n / 2);
		for (const x of [l, r]) {
			const re = new Float64Array(n),
				im = new Float64Array(n);
			for (let i = 0; i < n; i++) re[i] = x[start + i] * win[i];
			ifft(re, im);
			for (let k = 0; k < n / 2; k++) power[k] += re[k] ** 2 + im[k] ** 2;
		}
		const p = peak(power, lo, hi, 0);
		centers.push(1200 * Math.log2((p.center * bin) / (h * f0)));
		spreads.push(p.cents);
		levels.push(db(p.sum));
	}
	const sd = (a: number[]) => {
		const m = a.reduce((s, v) => s + v, 0) / a.length;
		return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
	};
	return { drift: sd(centers), spread: median(spreads), level: sd(levels) };
}

const fmt = (v: number, w = 6) => v.toFixed(0).padStart(w);
for (const key of keys) {
	const f0 = keyFreq(key),
		sa = render(aahs, 52, key),
		sc = render(custom, 0, key);
	const a = harmonics(spectrum(sa), f0).slice(0, 24),
		c = harmonics(spectrum(sc), f0).slice(0, 24),
		count = a.length;
	const ra = Math.max(...a.map((h) => h.level)),
		rc = Math.max(...c.map((h) => h.level));
	console.log(
		`\nkey ${key} (${f0.toFixed(0)} Hz), ${patch.name}; dB against the strongest harmonic`
	);
	console.log('   h     Hz | Aahs level noise spread | patch level noise spread');
	a.forEach((h, i) =>
		console.log(
			`${fmt(i + 1, 4)} ${fmt((i + 1) * f0)} |   ${fmt(db(h.level / ra))} ${fmt(db(h.noise / ra))} ${fmt(h.cents, 7)} |    ` +
				`${fmt(db(c[i].level / rc))} ${fmt(db(c[i].noise / rc))} ${fmt(c[i].cents, 7)}`
		)
	);
	// Over the harmonics within 50 dB of Choir Aahs's strongest: how far the levels are from Choir
	// Aahs's (as the contour's fit measures it, with the best offset for the key), and the
	// harmonics' height above the noise, and their spread.
	const heard = a.map((h, i) => i).filter((i) => db(a[i].level / ra) > -50);
	const avg = (f: (i: number) => number) => heard.reduce((s, i) => s + f(i), 0) / heard.length;
	console.log(
		`summary: level error (rms) ${fitContour([a], [c], [key]).before.toFixed(1)} dB, ` +
			`above the noise ${avg((i) => db(a[i].level / a[i].noise)).toFixed(0)} / ${avg((i) => db(c[i].level / c[i].noise)).toFixed(0)} dB, ` +
			`spread ${avg((i) => a[i].cents).toFixed(0)} / ${avg((i) => c[i].cents).toFixed(0)} cents (Aahs / patch)`
	);

	// The fundamental, the strongest harmonic below 1 kHz of Choir Aahs, and a high one.
	const strong = a.slice(0, Math.max(1, Math.floor(1000 / f0)));
	for (const h of new Set([
		1,
		strong.indexOf(strong.reduce((x, y) => (y.level > x.level ? y : x))) + 1,
		Math.min(count, Math.round(2500 / f0))
	])) {
		const ma = motion(sa, f0, h),
			mc = motion(sc, f0, h);
		console.log(
			`harmonic ${h} in 171 ms windows: center moves (sd) ${ma.drift.toFixed(1)} / ${mc.drift.toFixed(1)} cents, ` +
				`spread ${ma.spread.toFixed(0)} / ${mc.spread.toFixed(0)} cents, level varies (sd) ${ma.level.toFixed(1)} / ${mc.level.toFixed(1)} dB (Aahs / patch)`
		);
	}
}

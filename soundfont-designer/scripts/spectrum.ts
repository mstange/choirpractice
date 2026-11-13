// Compares the long-term spectrum of the sustain of MS Basic's Choir Aahs with a patch's, as
// spessasynth renders them: per harmonic its level, the noise between it and the next, and how
// widely it is spread, and how a strong harmonic moves over time.
//
// Usage: node scripts/spectrum.ts [patch name from presets.ts, or a patch's JSON file] [keys]
import { readFileSync } from 'node:fs';
import { BasicSoundBank, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';
import { buildBank } from '../src/lib/build.ts';
import { ifft, keyFreq } from '../src/lib/dsp.ts';
import { complete } from '../src/lib/patch.ts';
import { STARTING_POINTS } from '../src/lib/presets.ts';

const RATE = 48000,
	N = 2 ** 16,
	FROM = 1.5,
	TO = 5.5,
	VELOCITY = 80;
const soundfonts = new URL('../../choirpractice-app/media/soundfont/', import.meta.url).pathname;
const arg = process.argv[2] ?? 'Practice Voice',
	patch = arg.endsWith('.json')
		? complete(JSON.parse(readFileSync(arg, 'utf8')))
		: STARTING_POINTS.find((p) => p.name === arg)!;
const keys = (process.argv[3] ?? '45,52,60,67,72').split(',').map(Number);

await BasicSoundBank.ready;
const aahs = SoundBankLoader.fromArrayBuffer(
	readFileSync(`${soundfonts}52.sf3`).buffer as ArrayBuffer
);
const custom = SoundBankLoader.fromArrayBuffer(
	buildBank(patch, 54).bank.writeSF2({ writeDefaultModulators: true })
);

/** Both channels of a note at mf, with CC2 at the velocity, from FROM to TO seconds. */
function render(bank: BasicSoundBank, program: number, key: number) {
	const synth = new SpessaSynthProcessor(RATE, { effectsEnabled: false });
	synth.soundBankManager.addSoundBank(bank, 'b');
	synth.programChange(0, program);
	synth.controllerChange(0, 2, VELOCITY);
	synth.noteOn(0, key, VELOCITY);
	const l = new Float32Array(TO * RATE),
		r = new Float32Array(TO * RATE);
	for (let i = 0; i < l.length; i += 128) synth.process(l, r, i, 128);
	return [l.slice(FROM * RATE), r.slice(FROM * RATE)];
}

/** Power spectrum, Welch's method with a Hann window, both channels summed. */
function spectrum(channels: Float32Array[]) {
	const power = new Float64Array(N / 2),
		win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
	for (const x of channels)
		for (let start = 0; start + N <= x.length; start += N / 4) {
			const re = new Float64Array(N),
				im = new Float64Array(N);
			for (let i = 0; i < N; i++) re[i] = x[start + i] * win[i];
			ifft(re, im); // of a real signal, the conjugate of the forward transform
			for (let k = 0; k < N / 2; k++) power[k] += re[k] ** 2 + im[k] ** 2;
		}
	return power;
}

const db = (p: number) => 10 * Math.log10(p + 1e-30);

/**
 * The power in bins `lo` to `hi` above `floor` per bin, and its spread: twice the power-weighted
 * standard deviation, in cents around its center.
 */
function peak(power: Float64Array, lo: number, hi: number, floor: number) {
	let sum = 0,
		m1 = 0,
		m2 = 0;
	for (let k = lo; k <= hi; k++) {
		const p = Math.max(0, power[k] - floor);
		sum += p;
		m1 += p * k;
		m2 += p * k * k;
	}
	const center = m1 / sum,
		sd = Math.sqrt(Math.max(0, m2 / sum - center * center));
	return { sum, center, cents: 1200 * Math.log2((center + sd) / (center - sd)) };
}

const median = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1];

/**
 * Per harmonic: its power (within ±1/4 of the fundamental), the noise (the median bin in the
 * middle half between it and the next harmonic, times the bins of a harmonic's window), and its
 * spread in cents.
 */
function harmonics(power: Float64Array, f0: number, count: number, bin = RATE / N) {
	const list = [];
	for (let h = 1; h <= count; h++) {
		const lo = Math.round(((h - 0.25) * f0) / bin),
			hi = Math.round(((h + 0.25) * f0) / bin),
			gap = [];
		for (let k = hi; k <= Math.round(((h + 0.75) * f0) / bin); k++) gap.push(power[k]);
		const floor = median(gap),
			{ sum, cents } = peak(power, lo, hi, floor);
		list.push({ level: sum, noise: floor * (hi - lo + 1), cents });
	}
	return list;
}

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
		count = Math.min(24, Math.floor(10000 / f0));
	const sa = render(aahs, 52, key),
		sc = render(custom, 54, key);
	const a = harmonics(spectrum(sa), f0, count),
		c = harmonics(spectrum(sc), f0, count);
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
	// Aahs's, and the harmonics' height above the noise, and their spread.
	const heard = a.map((h, i) => i).filter((i) => db(a[i].level / ra) > -50);
	const avg = (f: (i: number) => number) => heard.reduce((s, i) => s + f(i), 0) / heard.length;
	console.log(
		`summary: level error (rms) ${Math.sqrt(avg((i) => (db(a[i].level / ra) - db(c[i].level / rc)) ** 2)).toFixed(1)} dB, ` +
			`above the noise ${avg((i) => db(a[i].level / a[i].noise)).toFixed(0)} / ${avg((i) => db(c[i].level / c[i].noise)).toFixed(0)} dB, ` +
			`spread ${avg((i) => a[i].cents).toFixed(0)} / ${avg((i) => c[i].cents).toFixed(0)} cents (Aahs / patch)`
	);
	// The strongest harmonic below 1 kHz, of Choir Aahs, and a high one.
	const strong = a.slice(0, Math.max(1, Math.floor(1000 / f0)));
	for (const h of [
		strong.indexOf(strong.reduce((x, y) => (y.level > x.level ? y : x))) + 1,
		Math.min(count, Math.round(2500 / f0))
	]) {
		const ma = motion(sa, f0, h),
			mc = motion(sc, f0, h);
		console.log(
			`harmonic ${h} in 171 ms windows: center moves (sd) ${ma.drift.toFixed(1)} / ${mc.drift.toFixed(1)} cents, ` +
				`spread ${ma.spread.toFixed(0)} / ${mc.spread.toFixed(0)} cents, level varies (sd) ${ma.level.toFixed(1)} / ${mc.level.toFixed(1)} dB (Aahs / patch)`
		);
	}
}

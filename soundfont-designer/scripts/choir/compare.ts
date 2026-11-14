// Writes WAV files for listening to a patch beside the recorded choir: per vowel and section, for
// each key that the section sings the vowel on long enough, its longest note on that key three
// times: the choir's whole note, consonants and all; the choir's sustain, without them; and the
// patch's sustain on the same key, bent to the choir's mean pitch. All at the same loudness. And
// prints where the patch's spectrum differs from the choir's, per octave.
//
// Usage: node scripts/choir/compare.ts [preset name or patch JSON, default Recorded Choir]
//   [vowels, default a ɛ i ɔ u] [--out directory, default .dev/choir/compare]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BasicSoundBank, SpessaSynthProcessor } from 'spessasynth_core';
import { keyFreq } from '../../src/lib/dsp.ts';
import { patchBank } from '../../src/lib/measure.ts';
import { complete, type Patch } from '../../src/lib/patch.ts';
import { STARTING_POINTS } from '../../src/lib/presets.ts';
import {
	SECTIONS,
	harmonicPowers,
	readNotes,
	root,
	sectionF0,
	sectionMix,
	type Note
} from './data.ts';

const args = process.argv.slice(2),
	outAt = args.indexOf('--out'),
	out = outAt >= 0 ? args.splice(outAt, 2)[1] : `${root}.dev/choir/compare`,
	[which = 'Recorded Choir', ...listed] = args,
	vowels = listed.length ? listed : ['a', 'ɛ', 'i', 'ɔ', 'u'];
const base: Patch = which.endsWith('.json')
	? complete(JSON.parse(readFileSync(which, 'utf8')))
	: structuredClone(STARTING_POINTS.find((p) => p.name === which)!);
if (!base) throw new Error(`no preset ${which}`);
const NAMES: Record<string, string> = { a: 'ah', ɛ: 'eh', i: 'ee', ɔ: 'aw', u: 'oo' };

/** Seconds of a note's sustain: from its start, and before its end. */
const SUSTAIN_FROM = 0.15,
	SUSTAIN_BEFORE = 0.1,
	/** Before the note's start, where its unvoiced consonants are, and after its end. */
	BEFORE = 0.2,
	AFTER = 0.05,
	/** The sustain's shortest length, and the patch's seconds before its sustain. */
	SHORTEST = 0.6,
	LONGEST = 2.75,
	SETTLE = 0.6,
	RMS = 10 ** (-23 / 20),
	FADE = 0.015;

/** A note of the patch at `key` bent by `cents`, both channels, `seconds` long after SETTLE. */
function render(bank: BasicSoundBank, key: number, cents: number, seconds: number, rate: number) {
	const synth = new SpessaSynthProcessor(rate, { effectsEnabled: false });
	synth.soundBankManager.addSoundBank(bank, 'b');
	synth.programChange(0, 0);
	synth.controllerChange(0, 2, 80);
	// The default bend range is two semitones.
	synth.pitchWheel(0, Math.round(8192 + (cents / 200) * 8192));
	synth.noteOn(0, key, 80);
	const n = Math.round((SETTLE + seconds) * rate),
		l = new Float32Array(n),
		r = new Float32Array(n);
	for (let i = 0; i < n; i += 128) synth.process(l, r, i, Math.min(128, n - i));
	const from = Math.round(SETTLE * rate);
	return [l.slice(from), r.slice(from)];
}

const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
function faded(x: Float32Array, gain: number, rate: number) {
	const y = x.map((v) => v * gain),
		f = Math.round(FADE * rate);
	for (let i = 0; i < f && i < y.length; i++) {
		y[i] *= i / f;
		y[y.length - 1 - i] *= i / f;
	}
	return y;
}

/** A 16-bit stereo WAV file of `clips`, each [left, right], with `gaps` seconds after each. */
function writeWav(
	path: string,
	clips: { l: Float32Array; r: Float32Array; gap: number }[],
	rate: number
) {
	const total = clips.reduce((s, c) => s + c.l.length + Math.round(c.gap * rate), 0),
		b = Buffer.alloc(44 + total * 4);
	b.write('RIFF', 0);
	b.writeUInt32LE(36 + total * 4, 4);
	b.write('WAVEfmt ', 8);
	b.writeUInt32LE(16, 16);
	b.writeUInt16LE(1, 20);
	b.writeUInt16LE(2, 22);
	b.writeUInt32LE(rate, 24);
	b.writeUInt32LE(rate * 4, 28);
	b.writeUInt16LE(4, 32);
	b.writeUInt16LE(16, 34);
	b.write('data', 36);
	b.writeUInt32LE(total * 4, 40);
	let o = 44;
	const s16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
	for (const c of clips) {
		for (let i = 0; i < c.l.length; i++, o += 4) {
			b.writeInt16LE(s16(c.l[i]), o);
			b.writeInt16LE(s16(c.r[i]), o + 2);
		}
		o += Math.round(c.gap * rate) * 4;
	}
	writeFileSync(path, b);
}

/** Octave bands, by their centres. */
const BANDS = [250, 500, 1000, 2000, 4000, 8000];
/** Per octave band, the power of the harmonics in it in dB, of a total normalized to 0 dB. */
function bands(level: number[], f0: number) {
	const total = level.reduce((s, v) => s + v, 0),
		sums = BANDS.map(() => 0);
	level.forEach((p, h) => {
		const b = Math.round(Math.log2(((h + 1) * f0) / 250));
		if (b >= 0 && b < BANDS.length) sums[b] += p;
	});
	return sums.map((s) => 10 * Math.log10(s / total + 1e-12));
}

await BasicSoundBank.ready;
mkdirSync(out, { recursive: true });
const notes = readNotes();
const header = `${'section key'.padEnd(13)}${BANDS.map((f) => (f < 1000 ? `${f}` : `${f / 1000}k`).padStart(6)).join('')}`;
console.log(`${base.name}: choir minus patch, dB per octave band (each normalized to its total)`);
for (const vowel of vowels) {
	const patch = structuredClone(base);
	patch.selected = vowel as Patch['selected'];
	const bank = patchBank(patch),
		diffs: number[][] = [];
	console.log(`\n${NAMES[vowel] ?? vowel} (${vowel})\n  ${header}`);
	for (const section of SECTIONS) {
		const longest = new Map<number, Note>();
		for (const n of notes[section])
			if (n.v === vowel && n.d - SUSTAIN_FROM - SUSTAIN_BEFORE >= SHORTEST)
				if (!longest.has(n.key) || longest.get(n.key)!.d < n.d) longest.set(n.key, n);
		if (!longest.size) continue;
		const { mix, rate } = sectionMix(section),
			f0s = sectionF0(section),
			pitchAt = (t: number) => {
				const p = f0s.map(({ hop, hz }) => hz[Math.round(t / hop)] ?? 0).filter((f) => f);
				return p.length < 2 ? null : 2 ** (p.reduce((s, f) => s + Math.log2(f), 0) / p.length);
			};
		const clips: { l: Float32Array; r: Float32Array; gap: number }[] = [],
			cues: string[] = [];
		let at = 0;
		for (const n of [...longest.values()].sort((a, b) => a.key - b.key)) {
			// A long note is cut short, so that the three come close enough together to compare.
			const end = n.t + Math.min(n.d, LONGEST),
				from = n.t + SUSTAIN_FROM,
				to = end - SUSTAIN_BEFORE,
				cents = 1200 * Math.log2(n.f0 / keyFreq(n.key)),
				sustain = mix.slice(Math.round(from * rate), Math.round(to * rate)),
				whole = mix.slice(
					Math.round((n.t - BEFORE) * rate),
					Math.round((end + (end < n.t + n.d ? 0 : AFTER)) * rate)
				),
				[l, r] = render(bank, n.key, cents, to - from, rate);
			const gain = RMS / rms(sustain),
				ours = RMS / Math.sqrt((rms(l) ** 2 + rms(r) ** 2) / 2);
			const w = faded(whole, gain, rate),
				s = faded(sustain, gain, rate);
			clips.push(
				{ l: w, r: w, gap: 0.3 },
				{ l: s, r: s, gap: 0.3 },
				{ l: faded(l, ours, rate), r: faded(r, ours, rate), gap: 1 }
			);
			cues.push(
				`${at.toFixed(1)} s: key ${n.key} (${cents >= 0 ? '+' : ''}${cents.toFixed(0)} cents), "${n.text}"`
			);
			at += (w.length + s.length + l.length) / rate + 1.6;

			const theirs = harmonicPowers(mix, rate, from, to, pitchAt).level,
				f0 = keyFreq(n.key) * 2 ** (cents / 1200),
				lp = harmonicPowers(l, rate, 0, to - from, () => f0).level,
				rp = harmonicPowers(r, rate, 0, to - from, () => f0).level,
				d = bands(theirs, n.f0).map(
					(v, i) =>
						v -
						bands(
							lp.map((p, h) => p + rp[h]),
							f0
						)[i]
				);
			diffs.push(d);
			console.log(
				`  ${`${section} ${n.key}`.padEnd(13)}${d.map((v) => (Number.isFinite(v) && Math.abs(v) < 60 ? v.toFixed(0) : '').padStart(6)).join('')}  "${n.text}"`
			);
		}
		const name = `${NAMES[vowel] ?? vowel}-${section}`;
		writeWav(`${out}/${name}.wav`, clips, rate);
		writeFileSync(`${out}/${name}.txt`, cues.join('\n') + '\n');
	}
	const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
	console.log(
		`  ${'median'.padEnd(13)}${BANDS.map((_, i) => {
			const v = diffs.map((d) => d[i]).filter((v) => Number.isFinite(v) && Math.abs(v) < 60);
			return (v.length ? median(v).toFixed(0) : '').padStart(6);
		}).join('')}`
	);
}
console.log(
	`\nwrote ${out}/<vowel>-<section>.wav, each note as: the choir's whole note, its sustain, the patch`
);

// Builds the default patch, writes it as SF2, reads it back and renders notes with spessasynth,
// to check what the file does: CC2 sets the tone's loudness during a note, velocity only the
// attack's, a bank can be swapped without resetting the synthesizer, and how loud the patch is
// against MS Basic's Choir Aahs.
//
// Usage: node scripts/test-bank.ts [path to the choir app's media/soundfont]
import { readFileSync } from 'node:fs';
import { BasicSoundBank, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';
import { buildBank } from '../src/lib/build.ts';
import { fitContour, matchContour, measure, patchBank } from '../src/lib/measure.ts';
import { DEFAULT_PATCH, MATCH_KEYS, complete } from '../src/lib/patch.ts';
import { Engine } from '../src/lib/synth/synth-engine.ts';
import { compress } from '../src/lib/vorbis.ts';

const RATE = 48000,
	PROGRAM = 54;
const soundfonts =
	process.argv[2] ?? new URL('../../choirpractice-app/media/soundfont/', import.meta.url).pathname;

const t = performance.now();
const { bank, clipped } = buildBank(DEFAULT_PATCH, PROGRAM);
const file = bank.writeSF2({ writeDefaultModulators: true });
console.log(
	`built in ${(performance.now() - t).toFixed(0)} ms: ${bank.samples.length} samples, ` +
		`${(file.byteLength / 1e6).toFixed(1)} MB, clipped zones: ${clipped.join(', ') || 'none'}`
);

await BasicSoundBank.ready;
const custom = SoundBankLoader.fromArrayBuffer(file);

/**
 * Renders `seconds` of a note on channel 0, calling `at` before each 50 ms block, and returns the
 * RMS in dB of each block, and of the difference of successive samples (a measure of brightness).
 */
function render(
	b: BasicSoundBank,
	program: number,
	key: number,
	vel: number,
	cc2: number,
	seconds: number,
	at: (synth: SpessaSynthProcessor, block: number) => void = () => {}
) {
	const synth = new SpessaSynthProcessor(RATE, { effectsEnabled: false });
	synth.soundBankManager.addSoundBank(b, 'b');
	synth.programChange(0, program);
	synth.controllerChange(0, 2, cc2);
	synth.noteOn(0, key, vel);
	const frame = RATE / 20,
		out: number[] = [],
		bright: number[] = [];
	for (let block = 0; block < seconds * 20; block++) {
		at(synth, block);
		const l = new Float32Array(frame),
			r = new Float32Array(frame);
		for (let i = 0; i < frame; i += 128) synth.process(l, r, i, Math.min(128, frame - i));
		let s = 0,
			d = 0;
		for (let i = 0; i < frame; i++) s += l[i] * l[i] + r[i] * r[i];
		for (let i = 1; i < frame; i++) d += (l[i] - l[i - 1]) ** 2;
		out.push(10 * Math.log10(s / (2 * frame) + 1e-12));
		bright.push(10 * Math.log10(d / frame + 1e-12));
	}
	return Object.assign(out, { bright });
}
const mean = (a: number[]) => 10 * Math.log10(a.reduce((s, d) => s + 10 ** (d / 10), 0) / a.length);
// Ensemble voices beat slowly, so the level is averaged over seconds.
const sustain = (a: number[]) => mean(a.slice(20, 80));
const fmt = (d: number) => d.toFixed(1).padStart(6);

let failed = false;
const check = (ok: boolean, what: string) => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
	if (!ok) failed = true;
};

// CC2 sets the tone's loudness; velocity doesn't.
const levels = [32, 64, 96, 127].map((cc) => sustain(render(custom, PROGRAM, 60, 64, cc, 4)));
console.log('sustain dB at CC2 32/64/96/127:', levels.map(fmt).join(''));
check(
	levels.every((d, i) => i === 0 || d > levels[i - 1] + 2),
	'louder with CC2'
);
const soft = sustain(render(custom, PROGRAM, 60, 20, 64, 4)),
	loud = sustain(render(custom, PROGRAM, 60, 120, 64, 4));
check(
	Math.abs(soft - loud) < 0.5,
	`sustain doesn't follow velocity (${fmt(soft)} vs ${fmt(loud)})`
);
// The attack does, heard alone with the tone silent at CC2 0.
const peak = (vel: number) => Math.max(...render(custom, PROGRAM, 60, vel, 0, 0.3).slice(0, 3));
check(peak(120) > peak(20) + 6, `attack follows velocity (${fmt(peak(20))} vs ${fmt(peak(120))})`);

// A swell during the note.
const swell = render(custom, PROGRAM, 60, 40, 40, 8, (synth, block) => {
	if (block === 80) synth.controllerChange(0, 2, 100);
});
check(sustain(swell.slice(80)) > sustain(swell) + 6, 'CC2 during a note changes it');

// Softer is darker: the difference signal loses more than the signal.
const tilt = (cc: number) => {
	const r = render(custom, PROGRAM, 48, 64, cc, 4);
	return sustain(r.bright) - sustain(r);
};
check(tilt(127) > tilt(32) + 1, `softer is darker (${fmt(tilt(32))} vs ${fmt(tilt(127))} dB)`);

// In stereo, the sides are separate ensembles, as loud together as the mono sample. Mixed down to
// mono, nothing cancels: the sides add up in power, where a mono sample in the middle adds up in
// amplitude, 3 dB louder.
{
	const wide = (width: number) =>
		SoundBankLoader.fromArrayBuffer(
			buildBank(
				complete({ ...DEFAULT_PATCH, tone: { ...DEFAULT_PATCH.tone, width } }),
				PROGRAM
			).bank.writeSF2({ writeDefaultModulators: true })
		);
	/** Seconds 1 to 4 of a note: the power of both channels and of their sum, and their correlation. */
	const stereo = (b: BasicSoundBank, key: number) => {
		const synth = new SpessaSynthProcessor(RATE, { effectsEnabled: false });
		synth.soundBankManager.addSoundBank(b, 'b');
		synth.programChange(0, PROGRAM);
		synth.controllerChange(0, 2, 100);
		synth.noteOn(0, key, 100);
		const l = new Float32Array(4 * RATE),
			r = new Float32Array(4 * RATE);
		for (let i = 0; i < l.length; i += 128) synth.process(l, r, i, 128);
		let ll = 0,
			rr = 0,
			lr = 0;
		for (let i = RATE; i < l.length; i++) {
			ll += l[i] * l[i];
			rr += r[i] * r[i];
			lr += l[i] * r[i];
		}
		const db = (e: number) => 10 * Math.log10(e / (3 * RATE));
		return { both: db(ll + rr), mono: db(ll + rr + 2 * lr), corr: lr / Math.sqrt(ll * rr) };
	};
	const narrow = wide(0),
		hard = wide(100),
		half = wide(50);
	for (const key of [45, 60, 72]) {
		const m = stereo(narrow, key),
			s = stereo(hard, key),
			h = stereo(half, key);
		console.log(
			`key ${key}: width 0/50/100: ${fmt(m.both)}${fmt(h.both)}${fmt(s.both)} dB, ` +
				`in mono ${fmt(m.mono)}${fmt(h.mono)}${fmt(s.mono)} dB, ` +
				`correlation ${m.corr.toFixed(2)} ${h.corr.toFixed(2)} ${s.corr.toFixed(2)}`
		);
		check(
			Math.abs(s.both - m.both) < 1 && Math.abs(h.both - m.both) < 1,
			`key ${key}: as loud in stereo`
		);
		check(Math.abs(s.mono - s.both) < 1, `key ${key}: nothing cancels mixed to mono`);
		check(Math.abs(s.corr) < 0.3, `key ${key}: the sides are unrelated at width 100`);
	}
}

// Copies of the fundamental make it beat, without changing the loudness.
{
	const beating = SoundBankLoader.fromArrayBuffer(
		buildBank(
			complete({ ...DEFAULT_PATCH, tone: { ...DEFAULT_PATCH.tone, fundamentalDetune: 25 } }),
			PROGRAM
		).bank.writeSF2({ writeDefaultModulators: true })
	);
	for (const key of [45, 60, 72]) {
		const steady = sustain(render(custom, PROGRAM, key, 64, 64, 4)),
			copies = sustain(render(beating, PROGRAM, key, 64, 64, 4));
		check(
			Math.abs(copies - steady) < 1,
			`key ${key}: as loud with copies of the fundamental (${fmt(copies)} vs ${fmt(steady)} dB)`
		);
	}
}

// Swapping the bank behind an id, as the page does, keeps the controllers and takes effect for
// the next note.
{
	const synth = new SpessaSynthProcessor(RATE, { effectsEnabled: false });
	synth.soundBankManager.addSoundBank(custom, 'custom');
	synth.programChange(0, PROGRAM);
	synth.controllerChange(0, 7, 50);
	const quieter = complete({ ...DEFAULT_PATCH, tone: { ...DEFAULT_PATCH.tone, level: -20 } });
	const other = SoundBankLoader.fromArrayBuffer(
		buildBank(quieter, PROGRAM).bank.writeSF2({ writeDefaultModulators: true })
	);
	const entry = synth.soundBankManager.soundBankList.find((e) => e.id === 'custom')!;
	entry.soundBank = other;
	synth.refreshPresets();
	check(synth.midiChannels[0].midiControllers[7] >> 7 === 50, 'swap keeps the controllers');
	check(
		synth.midiChannels[0].preset?.name === quieter.name &&
			synth.soundBankManager.soundBankList.length === 1,
		'swap selects the new preset'
	);
}

// The page's audio thread: a new version of the bank under the same id is played by the next
// note on the channel that has its program, and adding a bank while playing keeps the
// controllers that the score set.
{
	const engine = new Engine(RATE);
	const bank = (level: number) => {
		const p = complete({ ...DEFAULT_PATCH, tone: { ...DEFAULT_PATCH.tone, level } });
		const file = buildBank(p, PROGRAM).bank.writeSF2({ writeDefaultModulators: true });
		const read = SoundBankLoader.fromArrayBuffer(file.slice(0));
		const samples = read.samples.map((s, index) => ({ index, data: s.getAudioData() }));
		return { type: 'bank' as const, id: 'designed', buffer: file, samples };
	};
	/** The level in dB of a second of channel 16 playing middle C, starting at `frame`. */
	const level = (frame: number) => {
		engine.receive({ type: 'midi', data: [0xb0, 2, 100], offset: 16 });
		engine.receive({ type: 'midi', data: [0x90, 60, 100], offset: 16 });
		let e = 0;
		for (let i = 0; i < RATE; i += 128) {
			const l = new Float32Array(128),
				r = new Float32Array(128);
			engine.render(frame + i, l, r);
			if (i > RATE / 2) for (const v of l) e += v * v;
		}
		engine.receive({ type: 'midi', data: [0x80, 60, 0], offset: 16 });
		for (let i = 0; i < RATE; i += 128)
			engine.render(frame + RATE + i, new Float32Array(128), new Float32Array(128));
		return 10 * Math.log10(e / (RATE / 2));
	};
	engine.receive(bank(0));
	engine.receive({ type: 'program', ch: 16, program: PROGRAM });
	const first = level(0);
	engine.receive(bank(-20));
	const second = level(2 * RATE);
	check(
		Math.abs(first - second - 20) < 1,
		`engine plays the new bank (${fmt(first)} → ${fmt(second)} dB)`
	);

	// A score that sets channel 0's volume, playing; then a bank is added.
	engine.receive({
		type: 'score',
		events: [{ t: 0, data: [0xb0, 7, 40] }],
		notes: []
	});
	engine.receive({ type: 'play', frame: 4 * RATE, pos: 0, rate: 1, loop: null, seek: true });
	for (let i = 0; i < RATE / 10; i += 128)
		engine.render(4 * RATE + i, new Float32Array(128), new Float32Array(128));
	engine.receive({ ...bank(0), id: 'another' });
	check(
		engine.synth.midiChannels[0].midiControllers[7] >> 7 === 40,
		"adding a bank while playing keeps the score's controllers"
	);
}

// Exported as SF3: the samples decode to their lengths, keep their loops, and play as loud.
{
	const t = performance.now();
	await compress(bank);
	const sf3 = bank.writeSF2({ writeDefaultModulators: true });
	const read = SoundBankLoader.fromArrayBuffer(sf3);
	console.log(
		`SF3 in ${(performance.now() - t).toFixed(0)} ms: ${(sf3.byteLength / 1e6).toFixed(2)} MB`
	);
	check(
		read.samples.every((s, i) => {
			const pcm = custom.samples[i];
			return (
				s.isCompressed &&
				s.getAudioData().length === pcm.getAudioData().length &&
				s.loopStart === pcm.loopStart &&
				s.loopEnd === pcm.loopEnd
			);
		}),
		'SF3 samples keep their lengths and loops'
	);
	for (const key of [45, 60, 72]) {
		const a = sustain(render(custom, PROGRAM, key, 64, 64, 4)),
			b = sustain(render(read, PROGRAM, key, 64, 64, 4));
		check(Math.abs(a - b) < 0.3, `key ${key}: as loud in SF3 (${fmt(b)} vs ${fmt(a)} dB)`);
	}
}

// Against Choir Aahs, at the same dynamics.
let aahs: BasicSoundBank | null = null;
try {
	aahs = SoundBankLoader.fromArrayBuffer(readFileSync(`${soundfonts}52.sf3`).buffer as ArrayBuffer);
} catch (e) {
	console.log(`(no comparison with Choir Aahs: ${(e as Error).message})`);
}
if (aahs) {
	for (const key of [45, 60, 72]) {
		const a = sustain(render(aahs, 52, key, 64, 64, 4)),
			c = sustain(render(custom, PROGRAM, key, 64, 64, 4));
		console.log(`key ${key}: Choir Aahs ${fmt(a)} dB, patch ${fmt(c)} dB`);
	}

	// Matching the contour brings the harmonics nearer Choir Aahs's, measured again, about as near
	// as the fit expects, and keeps the loudness.
	const matched = matchContour(aahs, 52, DEFAULT_PATCH),
		theirs = MATCH_KEYS.map((key) => measure(aahs, 52, key)),
		ours = patchBank(complete({ ...DEFAULT_PATCH, contour: matched.contour })),
		again = fitContour(
			theirs,
			MATCH_KEYS.map((key) => measure(ours, 0, key)),
			MATCH_KEYS
		).before;
	check(
		again < matched.before - 3 && again < matched.after + 1,
		`matched to Choir Aahs: ${matched.before.toFixed(1)} → ${again.toFixed(1)} dB rms ` +
			`(fitted ${matched.after.toFixed(1)})`
	);
	const level = sustain(render(ours, 0, 60, 64, 64, 4)),
		unmatched = sustain(render(custom, PROGRAM, 60, 64, 64, 4));
	check(Math.abs(level - unmatched) < 1, `as loud matched (${fmt(level)} vs ${fmt(unmatched)} dB)`);
}

process.exit(failed ? 1 : 0);

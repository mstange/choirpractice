// Builds the default patch, writes it as SF2, reads it back and renders notes with spessasynth,
// to check what the file does: CC2 sets the tone's loudness during a note, velocity only the
// attack's, a bank can be swapped without resetting the synthesizer, and how loud the patch is
// against MS Basic's Choir Aahs.
//
// Usage: node scripts/test-bank.ts [path to media/soundfont]
import { readFileSync } from 'node:fs';
import { BasicSoundBank, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';
import { buildBank } from '../src/lib/build.ts';
import { atKey } from '../src/lib/dsp.ts';
import { fitContour, matchContour, measure, patchBank } from '../src/lib/measure.ts';
import {
	CONTOUR_FREQS,
	DEFAULT_PATCH,
	EDITING_BANK,
	MATCH_KEYS,
	complete,
	type Patch,
	type VowelFormants
} from '../src/lib/patch.ts';
import { toneHarmonics } from '../src/lib/spectrum.ts';
import { vowelFormants } from '../src/lib/vowel.ts';
import { Engine } from '../../site/src/lib/synth-engine.ts';
import { VOWELS } from '../../site/src/lib/vowels.ts';
import { compress } from '../src/lib/vorbis.ts';

const RATE = 48000,
	PROGRAM = 54;
const soundfonts = process.argv[2] ?? new URL('../../media/soundfont/', import.meta.url).pathname;

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

// The aperiodic noise lies between the harmonics at its level against them, set per register,
// in between on the keys between and on the line through the last two beyond the top one, and
// by the frequency: measured in half a harmonic's spacing, 3 dB below it, against the mean in dB
// of the harmonics on either side.
{
	const tone = {
		...DEFAULT_PATCH.tone,
		noise: -90,
		aperiodic: [-10, -20, -26],
		aperiodicTilt: [6, 4, 2]
	};
	const noisy = patchBank(complete({ ...DEFAULT_PATCH, tone })),
		db = (p: number) => 10 * Math.log10(p);
	for (const key of [48, 72, 82]) {
		const hs = measure(noisy, 0, key),
			f0 = 440 * 2 ** ((key - 69) / 12),
			[level, tilt] = atKey(
				DEFAULT_PATCH.registerKeys,
				tone.aperiodic.map((v, g) => [v, tone.aperiodicTilt[g]]),
				key,
				true
			);
		const errors = hs.slice(0, 8).map((h, i) => {
			const between = (db(h.level) + db(hs[i + 1].level)) / 2,
				want = level - 3 + tilt * Math.log2(((i + 1.5) * f0) / 1000);
			return Math.abs(db(h.noise) - between - want);
		});
		const error = Math.max(...errors);
		check(
			error < 1,
			`key ${key}: aperiodic noise at its level, ${level.toFixed(1)} dB (within ${error.toFixed(1)} dB)`
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

// A vowel set: a preset per vowel of the choir app, in its bank, those of the same formants
// sharing their tone's instrument, and the engine playing the vowel that a bank select in the
// score gives, also after a seek.
{
	const p = complete({
		...DEFAULT_PATCH,
		name: 'Set',
		oneVowel: false,
		vowels: {
			u: { vowel: 'sung', sung: [0.54, 0.32, 0.77], measured: [] },
			i: { vowel: 'i', sung: [1, 1, 1], measured: [] }
		}
	});
	const t = performance.now();
	const set = buildBank(p, PROGRAM, { editing: true }).bank;
	const file = set.writeSF2({ writeDefaultModulators: true });
	console.log(
		`vowel set built in ${(performance.now() - t).toFixed(0)} ms: ${set.samples.length} samples, ` +
			`${(file.byteLength / 1e6).toFixed(1)} MB`
	);
	const banks = set.presets.map((q) => q.bankMSB).sort((a, b) => a - b);
	check(
		banks.join() === [...VOWELS.keys(), EDITING_BANK].join(),
		`a preset per vowel, and the one edited (banks ${banks.join(' ')})`
	);
	// a, e and o from the table (the selected vowel is the table's a), i and u as designed.
	const tones = new Set(set.instruments.filter((x) => x.name.includes('Tone')).map((x) => x.name));
	check(tones.size === 5, `vowels of the same formants share an instrument (${tones.size} tones)`);

	const engine = new Engine(RATE);
	const read = SoundBankLoader.fromArrayBuffer(file.slice(0));
	engine.receive({
		type: 'bank',
		id: 'set',
		buffer: file,
		samples: read.samples.map((s, index) => ({ index, data: s.getAudioData() }))
	});
	const oo = VOWELS.findIndex((v) => v.ipa === 'u'),
		ih = VOWELS.findIndex((v) => v.ipa === 'ɪ');
	engine.receive({
		type: 'score',
		events: [
			{ t: 0, data: [0xb0, 0, oo] },
			{ t: 0, data: [0x90, 60, 80] },
			{ t: 0.5, data: [0x80, 60, 0] },
			{ t: 0.5, data: [0xb0, 0, ih] },
			{ t: 0.5, data: [0x90, 62, 80] },
			{ t: 1, data: [0x80, 62, 0] }
		],
		notes: [
			{ t0: 0, t1: 0.5, ch: 0, key: 60, vel: 80, bank: oo },
			{ t0: 0.5, t1: 1, ch: 0, key: 62, vel: 80, bank: ih }
		]
	});
	engine.receive({ type: 'program', ch: 0, program: PROGRAM });
	let frame = 0;
	const presetAt = (pos: number) => {
		engine.receive({ type: 'play', frame, pos, rate: 1, loop: null, seek: true });
		for (let i = 0; i < RATE / 10; i += 128, frame += 128)
			engine.render(frame, new Float32Array(128), new Float32Array(128));
		return engine.synth.midiChannels[0].preset?.name;
	};
	const names = [presetAt(0), presetAt(0.45), presetAt(0.7), presetAt(0.2)];
	check(
		names.join() === ['Set oo', 'Set ih', 'Set ih', 'Set oo'].join(),
		`the engine plays the score's vowels (${names.join(', ')})`
	);
	// ih and eh aren't designed: ih sings the designed i, eh the table's e.
	const tone = (name: string) =>
		set.presets.find((q) => q.name === `Set ${name}`)!.zones[0].instrument.name;
	check(
		tone('ih') === tone('ee') && tone('eh') === tone('ay') && tone('uu') === tone('oo'),
		`a vowel not designed sings the nearest one (ih: ${tone('ih')}, eh: ${tone('eh')}, uu: ${tone('uu')})`
	);
}

// Patches saved before the vowels had rows of their own: the vowel being edited becomes the
// selected one, a sung vowel not kept the row of the table's vowel nearest it, and the "ah" that
// the sung vowels were measured against the sung a.
{
	const old = (vowel: object, vowels = {}) =>
		complete({ ...DEFAULT_PATCH, vowel, vowels } as unknown as Partial<Patch>);
	const ah = [700, 1150, 2600],
		oo = { vowel: 'sung', sung: [0.5, 0.5, 0.9], measured: [ah, [350, 575, 2340]] } as const;
	const oh = old({ vowel: 'o', amount: 1, width: 1.5, sung: [1, 1, 1], measured: [] }),
		uuus = old({ vowel: 'sung', amount: 1, width: 1.5, sung: [0.54, 0.32, 0.77], measured: [] }),
		kept = old({ ...oo, amount: 1, width: 1.5 }, { ʊ: oo });
	check(
		oh.selected === 'o' &&
			oh.oneVowel &&
			!Object.keys(oh.vowels).length &&
			JSON.stringify(oh.vowel) === '{"amount":1,"width":1.5}',
		`an old patch singing oh sings oh (${JSON.stringify([oh.selected, oh.oneVowel, oh.vowel])})`
	);
	check(
		uuus.selected === 'u' && uuus.oneVowel && uuus.vowels.u?.sung.join() === '0.54,0.32,0.77',
		`an old patch singing a sung oo keeps it as oo (${uuus.selected})`
	);
	check(
		kept.selected === 'ʊ' && !kept.oneVowel && kept.vowels.a?.measured[0].join() === ah.join(),
		`an old patch with kept vowels keeps them and their "ah" (${kept.selected}, ${Object.keys(kept.vowels)})`
	);
}

// A voice type's own vowel sings as fitted on the keys of its range, and from VOICE_FADE beyond
// them as the vowel for all voices, with something between them on the way.
{
	const own: VowelFormants = {
			vowel: 'fitted',
			sung: [1, 1, 1],
			measured: [],
			registers: DEFAULT_PATCH.registerKeys.map(() => ({
				freq: [300, 2300, 3000, 3500, 4200],
				bw: [60, 100, 120, 150, 200]
			})),
			contour: DEFAULT_PATCH.registerKeys.map(() => CONTOUR_FREQS.map((f) => (f > 1000 ? 6 : 0))),
			range: [60, 67]
		},
		p = complete({
			...DEFAULT_PATCH,
			vowel: { amount: 1, width: 1 },
			voices: { alto: { a: own } },
			voice: 'alto'
		});
	const harmonics = (f: VowelFormants, key: number) =>
		toneHarmonics(p, key, 440 * 2 ** ((key - 69) / 12), 32000, f).map((h) => h.amp);
	const apart = (a: number[], b: number[]) =>
		Math.max(...a.map((x, i) => Math.abs(20 * Math.log10(x / b[i]))));
	const sung = vowelFormants(p, 'a').formants,
		shared = vowelFormants(p, 'a', null).formants;
	for (const [key, near] of [
		[63, 'own'],
		[69, 'between'],
		[72, 'shared'],
		[52, 'shared']
	] as const) {
		const toOwn = apart(harmonics(sung, key), harmonics(own, key)),
			toShared = apart(harmonics(sung, key), harmonics(shared, key));
		check(
			near === 'own'
				? toOwn < 0.01
				: near === 'shared'
					? toShared < 0.01
					: toOwn > 1 && toShared > 1,
			`key ${key}: a voice type's vowel ${near === 'between' ? 'between its own and the shared one' : `as the ${near} one`} (${toOwn.toFixed(1)} and ${toShared.toFixed(1)} dB from them)`
		);
	}
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

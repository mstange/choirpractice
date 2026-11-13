// Builds the default patch, writes it as SF2, reads it back and renders notes with spessasynth,
// to check what the file does: CC2 sets the tone's loudness during a note, velocity only the
// attack's, a bank can be swapped without resetting the synthesizer, and how loud the patch is
// against MS Basic's Choir Aahs.
//
// Usage: node scripts/test-bank.ts [path to the choir app's media/soundfont]
import { readFileSync } from 'node:fs';
import { BasicSoundBank, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';
import { buildBank } from '../src/lib/build.ts';
import { DEFAULT_PATCH, complete } from '../src/lib/patch.ts';

const RATE = 48000,
	PROGRAM = 54;
const soundfonts = process.argv[2] ?? new URL('../../choirpractice-app/media/soundfont/', import.meta.url).pathname;

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
check(levels.every((d, i) => i === 0 || d > levels[i - 1] + 2), 'louder with CC2');
const soft = sustain(render(custom, PROGRAM, 60, 20, 64, 4)),
	loud = sustain(render(custom, PROGRAM, 60, 120, 64, 4));
check(Math.abs(soft - loud) < 0.5, `sustain doesn't follow velocity (${fmt(soft)} vs ${fmt(loud)})`);
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

// Against Choir Aahs, at the same dynamics.
try {
	const aahs = SoundBankLoader.fromArrayBuffer(
		readFileSync(`${soundfonts}52.sf3`).buffer as ArrayBuffer
	);
	for (const key of [45, 60, 72]) {
		const a = sustain(render(aahs, 52, key, 64, 64, 4)),
			c = sustain(render(custom, PROGRAM, key, 64, 64, 4));
		console.log(`key ${key}: Choir Aahs ${fmt(a)} dB, patch ${fmt(c)} dB`);
	}
} catch (e) {
	console.log(`(no comparison with Choir Aahs: ${(e as Error).message})`);
}

process.exit(failed ? 1 : 0);

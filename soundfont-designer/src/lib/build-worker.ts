// Builds a patch's sound bank off the main thread, writes it as an SF2 file and reads that back,
// so that the page plays the file as written, and renders a note of it at a few dynamics for the
// envelope plot. For exporting, it writes the file as SF3 instead, its samples compressed, which
// takes longer than building.
import { BasicSoundBank, SoundBankLoader, SpessaSynthProcessor } from 'spessasynth_core';
import { buildBank } from './build.ts';
import type { Patch } from './patch.ts';
import type { DecodedSample } from './synth/synth-engine.ts';
import { compress } from './vorbis.ts';

/** A build for playing, with a preview of `key`, or for exporting. */
export type BuildRequest = { id: number; patch: Patch; program: number } & (
	{ key: number } | { export: true }
);

/** The level over time of a note rendered at some dynamics. */
export type Curve = { label: string; db: Float32Array };
export type Preview = {
	/** Seconds per value of the curves, and when the note is released. */
	step: number;
	off: number;
	curves: Curve[];
};

export type Built = {
	file: ArrayBuffer;
	/** All samples of the file, decoded, by index. */
	samples: DecodedSample[];
	clipped: number[];
	/** The start of the tone's sample for the preview key. */
	wave: Float32Array;
	waveRate: number;
	preview: Preview;
	ms: number;
};
export type BuildReply = { id: number } & (
	{ built: Built } | { exported: ArrayBuffer } | { error: string }
);

const RATE = 48000,
	STEP = 0.01,
	SMOOTH = 2,
	OFF = 2,
	END = 2.8;

/**
 * MuseScore's velocities, which its CC2 starts each note at: p, mf and ff, and a crescendo from p
 * to ff during the note.
 */
const DYNAMICS: [label: string, from: number, to: number][] = [
	['p', 49, 49],
	['mf', 80, 80],
	['ff', 112, 112],
	['p < ff', 49, 112]
];

function render(
	bank: BasicSoundBank,
	program: number,
	key: number,
	[, from, to]: (typeof DYNAMICS)[0]
) {
	const synth = new SpessaSynthProcessor(RATE, { effectsEnabled: false });
	synth.soundBankManager.addSoundBank(bank, 'b');
	synth.programChange(0, program);
	synth.controllerChange(0, 2, from);
	synth.noteOn(0, key, from);
	const frame = RATE * STEP,
		steps = Math.round(END / STEP),
		db = new Float32Array(steps),
		power = new Float64Array(steps),
		l = new Float32Array(frame),
		r = new Float32Array(frame);
	for (let i = 0; i < steps; i++) {
		const t = i * STEP;
		if (to !== from && t < OFF)
			synth.controllerChange(0, 2, Math.round(from + ((to - from) * t) / OFF));
		if (i === Math.round(OFF / STEP)) synth.noteOff(0, key);
		l.fill(0);
		r.fill(0);
		for (let j = 0; j < frame; j += 128) synth.process(l, r, j, Math.min(128, frame - j));
		for (let j = 0; j < frame; j++) power[i] += (l[j] * l[j] + r[j] * r[j]) / (2 * frame);
	}
	// Averaged over SMOOTH steps, which hides the shimmer of the ensemble but not the attack.
	for (let i = 0; i < steps; i++) {
		let s = 0,
			n = 0;
		for (let j = Math.max(0, i - SMOOTH); j <= Math.min(steps - 1, i + SMOOTH); j++, n++)
			s += power[j];
		db[i] = 10 * Math.log10(s / n + 1e-10);
	}
	return db;
}

onmessage = async ({ data }: MessageEvent<BuildRequest>) => {
	const { id, patch, program } = data;
	try {
		const start = performance.now();
		const { bank, clipped } = buildBank(patch, program);
		if ('export' in data) {
			await compress(bank);
			const exported = bank.writeSF2({ writeDefaultModulators: true });
			postMessage({ id, exported } satisfies BuildReply, [exported]);
			return;
		}
		const { key } = data;
		const file = bank.writeSF2({ writeDefaultModulators: true });
		await BasicSoundBank.ready;
		const read = SoundBankLoader.fromArrayBuffer(file.slice(0));
		const samples = read.samples.map((s, index) => ({ index, data: s.getAudioData() }));
		const tone = read.presets[0]
			.getVoiceParameters(key, 80)
			.find((v) => v.sample.name.startsWith('tone'))!.sample;
		const built: Built = {
			file,
			samples,
			clipped,
			wave: tone.getAudioData().slice(0, Math.round(tone.sampleRate * 0.03)),
			waveRate: tone.sampleRate,
			preview: {
				step: STEP,
				off: OFF,
				curves: DYNAMICS.map((d) => ({ label: d[0], db: render(read, program, key, d) }))
			},
			ms: performance.now() - start
		};
		postMessage({ id, built } satisfies BuildReply);
	} catch (e) {
		postMessage({ id, error: String((e as Error).message ?? e) } satisfies BuildReply);
	}
};

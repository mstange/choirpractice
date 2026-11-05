// Reads the score's MIDI file, and decodes the soundfont samples that the score's notes need, off
// the main thread and before the audio thread plays them (see synth.svelte.ts).
import { BasicMIDI, BasicSoundBank, SoundBankLoader } from 'spessasynth_core';
import type { DecodedSample, ScoreEvent, ScoreNote } from './synth-engine.ts';

export type Request =
	| { type: 'midi'; url: string }
	/** Decodes the samples that the bank at `url` needs for these notes, [key, velocity]. */
	| { type: 'samples'; url: string; notes: [number, number][] };

export type MidiReply = {
	events: ScoreEvent[];
	notes: ScoreNote[];
	/** The program of each channel that plays notes. */
	programs: Map<number, number>;
};
/** The bank, the first time it is asked for, and its samples that weren't decoded before. */
export type SamplesReply = { buffer?: ArrayBuffer; samples: DecodedSample[] };

/** Per URL, the bank, whether the audio thread got it, and which of its samples were decoded. */
const banks = new Map<
	string,
	Promise<{ bank: BasicSoundBank; buffer: ArrayBuffer; sent: boolean; decoded: Set<number> }>
>();

async function fetchBuffer(url: string) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.url}: ${res.status} ${res.statusText}`);
	return res.arrayBuffer();
}

async function readMidi(url: string): Promise<MidiReply> {
	const midi = BasicMIDI.fromArrayBuffer(await fetchBuffer(url));
	const events: ScoreEvent[] = [],
		notes: ScoreNote[] = [],
		programs = new Map<number, number>(),
		open = new Map<number, ScoreNote>();
	const all = midi.tracks
		.flatMap((track) => track.events)
		.filter((e) => e.statusByte >= 0x80 && e.statusByte < 0xf0)
		.sort((a, b) => a.ticks - b.ticks);
	for (const e of all) {
		const t = midi.midiTicksToSeconds(e.ticks),
			type = e.statusByte & 0xf0,
			ch = e.statusByte & 0x0f;
		if (type === 0xc0) {
			if (!programs.has(ch)) programs.set(ch, e.data[0]);
			continue;
		}
		events.push({ t, data: [e.statusByte, ...e.data] });
		if (type !== 0x80 && type !== 0x90) continue;
		const key = (ch << 7) | e.data[0];
		const note = open.get(key);
		if (note) {
			note.t1 = t;
			open.delete(key);
		}
		if (type === 0x90 && e.data[1] > 0) {
			const n = { t0: t, t1: Infinity, ch, key: e.data[0], vel: e.data[1] };
			notes.push(n);
			open.set(key, n);
			if (!programs.has(ch)) programs.set(ch, 0);
		}
	}
	return { events, notes, programs };
}

async function decode(url: string, notes: [number, number][]): Promise<SamplesReply> {
	await BasicSoundBank.ready;
	if (!banks.has(url))
		banks.set(
			url,
			fetchBuffer(url).then((buffer) => ({
				// The bank keeps views of its buffer, so the audio thread gets a copy.
				bank: SoundBankLoader.fromArrayBuffer(buffer.slice(0)),
				buffer,
				sent: false,
				decoded: new Set<number>()
			}))
		);
	const entry = await banks.get(url)!;
	const { bank, decoded } = entry,
		buffer = entry.sent ? undefined : entry.buffer,
		[preset] = bank.presets,
		samples: DecodedSample[] = [];
	entry.sent = true;
	for (const [key, vel] of notes)
		for (const { sample } of preset.getVoiceParameters(key, vel)) {
			const index = bank.samples.indexOf(sample);
			if (decoded.has(index)) continue;
			decoded.add(index);
			// The data goes to the audio thread; this thread needs it no more.
			samples.push({ index, data: sample.getAudioData() });
			sample.releaseDecoded();
		}
	return { buffer, samples };
}

onmessage = async ({ data: req }: MessageEvent<Request & { id: number }>) => {
	try {
		const reply = req.type === 'midi' ? await readMidi(req.url) : await decode(req.url, req.notes);
		const transfer =
			'samples' in reply
				? [...reply.samples.map((s) => s.data.buffer), ...(reply.buffer ? [reply.buffer] : [])]
				: [];
		postMessage({ id: req.id, reply }, { transfer });
	} catch (e) {
		postMessage({ id: req.id, error: String((e as Error).message ?? e) });
	}
};

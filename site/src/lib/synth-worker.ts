// Reads the score's MIDI file, and decodes the soundfont samples that the score's notes need, off
// the main thread and before the audio thread plays them (see synth.svelte.ts).
import { BasicSoundBank, SoundBankLoader } from 'spessasynth_core';
import { parseMidi, type MidiReply } from './midi.ts';
import { presetBank, type DecodedSample } from './synth-engine.ts';

export type Request =
	| { type: 'midi'; url: string }
	/** Decodes the samples that the sound bank at `url` needs for these notes. */
	| { type: 'samples'; url: string; notes: Played[] };

/** A note to decode samples for: its key and velocity, and the bank of its preset, by default 0. */
export type Played = [key: number, velocity: number, bank?: number];

export type { MidiReply };
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
	return parseMidi(await fetchBuffer(url));
}

async function decode(url: string, notes: Played[]): Promise<SamplesReply> {
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
		samples: DecodedSample[] = [];
	entry.sent = true;
	// The preset that a bank select plays, as the engine and the synthesizer pick it.
	const banksOf = bank.presets.map((p) => p.bankMSB),
		preset = (b = 0) =>
			bank.presets.find((p) => p.bankMSB === presetBank(banksOf, b)) ?? bank.presets[0];
	for (const [key, vel, b] of notes)
		for (const { sample } of preset(b).getVoiceParameters(key, vel)) {
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

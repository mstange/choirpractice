// Reads a score's MIDI file, for the synth worker and for saving a season for offline use.
import { BasicMIDI } from 'spessasynth_core';
import type { ScoreEvent, ScoreNote } from './synth-engine.ts';

export type MidiReply = {
	events: ScoreEvent[];
	notes: ScoreNote[];
	/** The program of each channel that plays notes. */
	programs: Map<number, number>;
};

/** The events and notes of a MIDI file, and the program of each channel that plays notes. */
export function parseMidi(buffer: ArrayBuffer): MidiReply {
	const midi = BasicMIDI.fromArrayBuffer(buffer);
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

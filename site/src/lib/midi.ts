// Reads a score's MIDI file, for the synth worker, and for an app that needs a score's events.
import { BasicMIDI } from 'spessasynth_core';
import type { ScoreEvent, ScoreNote } from './synth-engine.ts';

export type MidiReply = {
	events: ScoreEvent[];
	notes: ScoreNote[];
	/** The program of each channel that plays notes, at its first note. */
	programs: Map<number, number>;
	/** Per track, the channels it plays notes on. */
	tracks: number[][];
	/** Where the tempo changes: [tick, seconds, seconds per tick from there], by tick. */
	tempos: [number, number, number][];
	duration: number;
};

/**
 * The events and notes of a MIDI file, and the program of each channel that plays notes. A
 * channel of MIDI port p is channel 16 p + its number: MuseScore gives a score that needs more
 * than 16 channels more ports.
 */
export function parseMidi(buffer: ArrayBuffer): MidiReply {
	const midi = BasicMIDI.fromArrayBuffer(buffer);
	const events: ScoreEvent[] = [],
		notes: ScoreNote[] = [],
		programs = new Map<number, number>(),
		current = new Map<number, number>(),
		open = new Map<number, ScoreNote>(),
		tracks = midi.tracks.map(() => new Set<number>());
	const all = midi.tracks
		.flatMap((track, i) =>
			track.events.map((e) => ({ e, i, offset: midi.portChannelOffsetMap[track.port] ?? 0 }))
		)
		.filter(({ e }) => e.statusByte >= 0x80 && e.statusByte < 0xf0)
		.sort((a, b) => a.e.ticks - b.e.ticks);
	for (const { e, i, offset } of all) {
		const t = midi.midiTicksToSeconds(e.ticks),
			type = e.statusByte & 0xf0,
			ch = offset + (e.statusByte & 0x0f);
		// A channel can have program changes from several tracks: MuseScore gives a cello's
		// pizzicato a channel that the next staff's track then reuses with its own program.
		if (type === 0xc0) {
			current.set(ch, e.data[0]);
			continue;
		}
		events.push({ t, data: [e.statusByte, ...e.data], ...(offset ? { offset } : {}) });
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
			tracks[i].add(ch);
			if (!programs.has(ch)) programs.set(ch, current.get(ch) ?? 0);
		}
	}
	// From last to first, with the default at tick 0 last: of two at a tick, the file's wins.
	const changes = new Map([...midi.tempoChanges].reverse().map((c) => [c.ticks, c.tempo]));
	const tempos = [...changes]
		.sort((a, b) => a[0] - b[0])
		.map(([tick, bpm]): [number, number, number] => [
			tick,
			midi.midiTicksToSeconds(tick),
			60 / (bpm * midi.timeDivision)
		]);
	return {
		events,
		notes,
		programs,
		tracks: tracks.map((s) => [...s].sort((a, b) => a - b)),
		tempos,
		duration: midi.duration
	};
}

/** A part of the score and the MIDI channels it plays on. */
export interface PartMix {
	name: string;
	channels: number[];
}

/** The channels of each part: those of its staves' tracks (MuseScore writes a track per staff). */
export const partChannels = (
	parts: { name: string; staves: number[] }[],
	tracks: number[][]
): PartMix[] =>
	parts.map(({ name, staves }) => ({
		name,
		channels: [...new Set(staves.flatMap((staff) => tracks[staff - 1] ?? []))]
	}));

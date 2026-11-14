// How the vocal parts are sung, beyond the notes of the MIDI file: through a melisma, one note
// goes on into the next, rather than starting anew.
import type { ScoreEvent, ScoreNote } from './synth-engine.ts';
import type { Part, Voice } from './types.ts';

/** Seconds in which a melisma's note crossfades into the next. */
const LEGATO_FADE = 0.06;
/**
 * The most by which a note ends before the next starts and is still joined to it: MuseScore ends
 * each note a tick before the next.
 */
const JOIN = 0.01;

/**
 * Makes the notes of each vocal part's melismas legato (see ScoreEvent): every note of a
 * syllable after its first, at another pitch than the note before. A repeated pitch starts anew,
 * as a singer would mark it. The note-off of the note before moves to the legato note-on.
 *
 * Changes `events` and `notes` in place, only those on the vocal parts' channels, so it leaves
 * alone copies made for other channels, such as a piano that doubles a part.
 */
export function sing(events: ScoreEvent[], notes: ScoreNote[], parts: Part[], voices: Voice[]) {
	// The note-ons and note-offs of the score's channels, by channel, key and time.
	const ons = new Map<string, ScoreEvent>(),
		offs = new Map<string, ScoreEvent>();
	for (const e of events) {
		const type = e.data[0] & 0xf0;
		if (e.offset !== undefined || (type !== 0x80 && type !== 0x90)) continue;
		const id = `${e.data[0] & 0x0f}:${e.data[1]}:${e.t}`;
		if (type === 0x90 && e.data[2] > 0) ons.set(id, e);
		else offs.set(id, e);
	}
	let joined = false;
	for (const voice of voices) {
		const channels = parts.find((p) => p.name === voice.name)?.channels;
		if (channels?.length !== 1) continue;
		const mine = notes.filter((n) => n.ch === channels[0]);
		// The MIDI note of each of the voice's notes, if there is one.
		const midi = voice.notes.map((n) =>
			mine.find((m) => m.key === n.p && Math.abs(m.t0 - n.t0) < 1e-3)
		);
		for (let i = 1; i < voice.notes.length; i++) {
			const prev = midi[i - 1],
				note = midi[i];
			if (!prev || !note || voice.notes[i - 1].s !== voice.notes[i].s || prev.key === note.key)
				continue;
			if (prev.t1 > note.t0 || prev.t1 < note.t0 - JOIN) continue;
			const on = ons.get(`${note.ch}:${note.key}:${note.t0}`),
				off = offs.get(`${prev.ch}:${prev.key}:${prev.t1}`);
			if (!on || !off) continue;
			on.legato = { from: prev.key, fade: LEGATO_FADE };
			off.t = prev.t1 = note.t0;
			note.onset = prev.onset ?? prev.t0;
			joined = true;
		}
	}
	// A legato note-on comes after the note-off that it takes over from.
	if (joined) events.sort((a, b) => a.t - b.t || +!!a.legato - +!!b.legato);
}

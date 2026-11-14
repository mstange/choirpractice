// How the vocal parts are sung, beyond the notes of the MIDI file: each syllable on its vowel,
// and through a melisma, one note going on into the next rather than starting anew.
import type { ScoreEvent, ScoreNote } from './synth-engine.ts';
import type { Part, Voice } from './types.ts';
import { VOWEL_BANK } from './vowels.ts';

/** Seconds in which a melisma's note crossfades into the next. */
const LEGATO_FADE = 0.06;
/**
 * The most by which a note ends before the next starts and is still joined to it: MuseScore ends
 * each note a tick before the next.
 */
const JOIN = 0.01;

/**
 * Sings each vocal part's syllables on their vowels: a bank select (see ScoreEvent) before the
 * first note of each syllable picks the vowel's preset (see vowels.ts), for parts whose syllables
 * have vowels. An instrument without vowels plays its one preset for all of them.
 *
 * Makes the notes of each melisma legato (see ScoreEvent): every note of a syllable after its
 * first, at another pitch than the note before. A repeated pitch starts anew, as a singer would
 * mark it. The note-off of the note before moves to the legato note-on.
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
	const added: ScoreEvent[] = [];
	let joined = false;
	for (const voice of voices) {
		const channels = parts.find((p) => p.name === voice.name)?.channels;
		if (channels?.length !== 1) continue;
		const ch = channels[0],
			mine = notes.filter((n) => n.ch === ch);
		// The MIDI note of each of the voice's notes, if there is one.
		const midi = voice.notes.map((n) =>
			mine.find((m) => m.key === n.p && Math.abs(m.t0 - n.t0) < 1e-3)
		);

		if (voice.syllables.some((s) => s.v)) {
			// Per syllable, the bank of its vowel, at its first note.
			const banks: [t: number, bank: number][] = [];
			voice.notes.forEach((n, i) => {
				if (!midi[i] || (i && voice.notes[i - 1].s === n.s)) return;
				const v = voice.syllables[n.s].v;
				banks.push([midi[i]!.t0, VOWEL_BANK.get(typeof v === 'string' ? v : (v?.[0] ?? 'a'))!]);
			});
			for (const [t, bank] of banks) added.push({ t, data: [0xb0 | ch, 0, bank] });
			// Each note of the channel plays in the bank that the last bank select before it gave.
			let j = -1;
			for (const n of mine.sort((a, b) => a.t0 - b.t0)) {
				while (j + 1 < banks.length && banks[j + 1][0] <= n.t0) j++;
				n.bank = j < 0 ? 0 : banks[j][1];
			}
		}

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
	if (!added.length && !joined) return;
	events.push(...added);
	// At the same time, a bank select comes before the notes, and a legato note-on after the
	// note-off that it takes over from.
	const order = (e: ScoreEvent) =>
		e.legato ? 1 : (e.data[0] & 0xf0) === 0xb0 && e.data[1] === 0 ? -1 : 0;
	events.sort((a, b) => a.t - b.t || order(a) - order(b));
}

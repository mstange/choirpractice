import {
	FORMANT_PROGRAMS,
	METRONOME,
	METRONOME_KEYS,
	formantFile,
	soundfontFile
} from './instruments.ts';
import { sing } from './singing.ts';
import { Synth, type Score } from './synth.svelte.ts';
import type { MidiReply } from './synth-worker.ts';
import type { Part, Voice } from './types.ts';

/** The General MIDI program that can double the vocal parts. */
const PIANO = 0;

/**
 * The program of each channel of the parts: vocal parts with one channel play `vocalProgram`,
 * the others what the MIDI file gives them.
 */
const channelPrograms = (parts: Part[], midi: Map<number, number>, vocalProgram: number) =>
	new Map(
		parts.flatMap(({ vocal, channels }) =>
			channels.map((ch) => [
				ch,
				vocal && channels.length === 1 ? vocalProgram : (midi.get(ch) ?? 0)
			])
		)
	);

/**
 * The programs that a piece plays, including the piano that doubles its vocal parts and the
 * metronome.
 */
export function programsUsed(parts: Part[], midi: Map<number, number>, vocalProgram: number) {
	const used = new Set(channelPrograms(parts, midi, vocalProgram).values());
	if (parts.some((p) => p.vocal && p.channels.length)) used.add(PIANO);
	used.add(METRONOME);
	return used;
}
/**
 * The velocity of the piano that doubles a note of this velocity: it follows the part's dynamics
 * in the range from 32 to 100, since a soft piano note is hard to hear beside a choir sound.
 */
const pianoVelocity = (vel: number) => (vel ? Math.round(32 + (vel * (100 - 32)) / 128) : 0);

/**
 * The key and velocity of the metronome's clicks at each level: downbeats, the other beats, their
 * subdivisions and the subdivisions' subdivisions. The beats are mf like MuseScore's, and each
 * finer level is softer, so that the coarser ones stand out.
 */
const CLICKS = [
	{ key: METRONOME_KEYS.downbeat, vel: 80 },
	{ key: METRONOME_KEYS.beat, vel: 80 },
	{ key: METRONOME_KEYS.beat, vel: 56 },
	{ key: METRONOME_KEYS.beat, vel: 40 }
];
/** The length of a click. */
const CLICK = 0.05;

/**
 * Plays a piece's score.mid, each part on its MIDI channels, with the vocal parts on an instrument
 * of the user's choice.
 *
 * Each vocal part also plays its notes on a piano, on a channel of its own beyond the score's,
 * which stays silent until setPianoGain(). The vocal parts sing their melismas legato (see
 * singing.ts); the piano strikes every note. The instruments with a preset per vowel slide from
 * one vowel to another with their formant tables (FORMANT_PROGRAMS).
 *
 * A metronome clicks on the beats, as MuseScore's does, and softer on their subdivisions, each
 * level of clicks on a channel of its own, which stays silent until setMetronome().
 */
export class ChoirSynth extends Synth {
	#parts: Part[];
	#voices: Voice[];
	/** Per vocal part, the channel of its piano. */
	#pianos = new Map<string, number>();
	/**
	 * The channels of the vocal parts, which play #vocalProgram instead of the score's program. A
	 * part with several channels, such as a cello's arco and pizzicato, keeps its programs.
	 */
	#vocal: number[];
	#vocalProgram: number;
	/** The times of the metronome's clicks at each level of CLICKS, and the channel of each level. */
	#clicks: number[][];
	#metronome: number[] = [];

	constructor(
		parts: Part[],
		voices: Voice[],
		duration: number,
		clicks: number[][],
		soundfontUrl: (file: string) => string,
		vocalProgram: number
	) {
		super((program) => soundfontUrl(soundfontFile(program)), duration);
		this.#clicks = clicks.map((times) => times.filter((t) => t < duration));
		this.#parts = parts;
		this.#voices = voices;
		this.#vocal = parts.filter((p) => p.vocal && p.channels.length === 1).map((p) => p.channels[0]);
		this.#vocalProgram = vocalProgram;
		for (const program of FORMANT_PROGRAMS)
			fetch(soundfontUrl(formantFile(program)))
				.then((res) => {
					if (!res.ok) throw new Error(`${res.status} for ${res.url}`);
					return res.json();
				})
				.then((table) => this.setFormants(program, table))
				.catch((e) => this.fail(e));
		// Above the score's channels (of more than one MIDI port, 16 per port). Channel 9 of every
		// 16 plays drum kits.
		const ports = Math.ceil((Math.max(0, ...parts.flatMap((p) => p.channels)) + 1) / 16);
		let next = 16 * ports;
		for (const { name, vocal, channels } of parts) {
			if (!vocal || !channels.length) continue;
			if (next % 16 === 9) next++;
			this.#pianos.set(name, next++);
		}
		for (const _ of this.#clicks) {
			if (next % 16 === 9) next++;
			this.#metronome.push(next++);
		}
	}

	protected arrange({ events, notes, programs }: MidiReply): Score {
		// The channel of each score channel's piano.
		const piano = new Map(
			this.#parts.flatMap((p) =>
				this.#pianos.has(p.name) ? p.channels.map((ch) => [ch, this.#pianos.get(p.name)!]) : []
			)
		);
		// The piano gets the part's notes, at pianoVelocity(), and its volume, pan and expression,
		// so that it sits at the level of the part it doubles.
		const doubled = events.flatMap((e) => {
			const type = e.data[0] & 0xf0,
				ch = piano.get((e.data[0] & 0x0f) + (e.offset ?? 0));
			const copied =
				type === 0x80 || type === 0x90 || (type === 0xb0 && [7, 10, 11].includes(e.data[1]));
			if (ch === undefined || !copied) return [e];
			const data =
				type === 0x90 ? [type, e.data[1], pianoVelocity(e.data[2])] : [type, ...e.data.slice(1)];
			return [e, { t: e.t, data, offset: ch }];
		});
		notes.push(
			...notes
				.filter((n) => piano.has(n.ch))
				.map((n) => ({ ...n, ch: piano.get(n.ch)!, vel: pianoVelocity(n.vel) }))
		);
		sing(doubled, notes, this.#parts, this.#voices);
		this.#clicks.forEach((times, level) => {
			const { key, vel } = CLICKS[level],
				offset = this.#metronome[level];
			for (const t of times) {
				doubled.push(
					{ t, data: [0x90, key, vel], offset },
					{ t: t + CLICK, data: [0x80, key, 0], offset }
				);
				notes.push({ t0: t, t1: t + CLICK, ch: offset, key, vel });
			}
		});
		// sing() leaves the events in order; Array.sort() is stable, so it keeps theirs.
		doubled.sort((a, b) => a.t - b.t);
		const played = channelPrograms(this.#parts, programs, this.#vocalProgram);
		for (const ch of this.#pianos.values()) played.set(ch, PIANO);
		this.#clicks.forEach((times, level) => {
			if (times.length) played.set(this.#metronome[level], METRONOME);
		});
		return { events: doubled, notes, programs: played };
	}

	/** Plays the vocal parts with another General MIDI program. */
	async setVocalProgram(program: number) {
		if (program === this.#vocalProgram) return;
		this.#vocalProgram = program;
		// Until then, arrange() picks it up.
		if (!this.scored) return;
		try {
			await Promise.all(this.#vocal.map((ch) => this.setProgram(ch, program)));
		} catch (e) {
			this.fail(e);
		}
	}

	setGain(part: string, gain: number) {
		for (const ch of this.#parts.find((p) => p.name === part)?.channels ?? [])
			this.setChannelGain(ch, gain);
	}

	/** Sets the gain of the piano that doubles a vocal part. */
	setPianoGain(part: string, gain: number) {
		const ch = this.#pianos.get(part);
		if (ch !== undefined) this.setChannelGain(ch, gain);
	}

	/** Plays the metronome's clicks at gain up to the level-th of CLICKS, and none of the others. */
	setMetronome(level: number, gain: number) {
		this.#metronome.forEach((ch, i) => this.setChannelGain(ch, i < level ? gain : 0));
	}
}

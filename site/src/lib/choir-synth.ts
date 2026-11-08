import { soundfontFile } from './instruments.ts';
import { Synth, type Score } from './synth.svelte.ts';
import type { MidiReply } from './synth-worker.ts';
import type { Part } from './types.ts';

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

/** The programs that a piece plays, including the piano that doubles its vocal parts. */
export function programsUsed(parts: Part[], midi: Map<number, number>, vocalProgram: number) {
	const used = new Set(channelPrograms(parts, midi, vocalProgram).values());
	if (parts.some((p) => p.vocal && p.channels.length)) used.add(PIANO);
	return used;
}
/**
 * The velocity of the piano that doubles a note of this velocity: it follows the part's dynamics
 * in the range from 32 to 100, since a soft piano note is hard to hear beside a choir sound.
 */
const pianoVelocity = (vel: number) => (vel ? Math.round(32 + (vel * (100 - 32)) / 128) : 0);

/**
 * Plays a piece's score.mid, each part on its MIDI channels, with the vocal parts on an instrument
 * of the user's choice.
 *
 * Each vocal part also plays its notes on a piano, on a channel of its own beyond the score's 16,
 * which stays silent until setPianoGain().
 */
export class ChoirSynth extends Synth {
	#parts: Part[];
	/** Per vocal part, the channel of its piano. */
	#pianos = new Map<string, number>();
	/**
	 * The channels of the vocal parts, which play #vocalProgram instead of the score's program. A
	 * part with several channels, such as a cello's arco and pizzicato, keeps its programs.
	 */
	#vocal: number[];
	#vocalProgram: number;

	constructor(
		parts: Part[],
		duration: number,
		soundfontUrl: (file: string) => string,
		vocalProgram: number
	) {
		super(duration, (program) => soundfontUrl(soundfontFile(program)));
		this.#parts = parts;
		this.#vocal = parts.filter((p) => p.vocal && p.channels.length === 1).map((p) => p.channels[0]);
		this.#vocalProgram = vocalProgram;
		// Channel 9 of every 16 plays drum kits.
		let next = 16;
		for (const { name, vocal, channels } of parts) {
			if (!vocal || !channels.length) continue;
			if (next % 16 === 9) next++;
			this.#pianos.set(name, next++);
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
				ch = piano.get(e.data[0] & 0x0f);
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
		const played = channelPrograms(this.#parts, programs, this.#vocalProgram);
		for (const ch of this.#pianos.values()) played.set(ch, PIANO);
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
}

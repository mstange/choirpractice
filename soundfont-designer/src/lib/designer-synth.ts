import { Synth, type Score } from './synth/synth.svelte.ts';
import type { MidiReply } from './synth/synth-worker.ts';
import type { DecodedSample, ScoreEvent, ScoreNote } from './synth/synth-engine.ts';

/** The General MIDI program of the designed instrument while it is played here. */
export const DESIGNED = 54;
/** The channel of the on-screen keyboard: the first beyond the score's 16. */
const KEYBOARD = 16;
/** The [key, velocity] of the keyboard's notes, whose samples are decoded ahead. */
const KEYBOARD_NOTES = Array.from({ length: 49 }, (_, i) =>
	[49, 80, 112].map((v) => [36 + i, v] as [number, number])
).flat();

/** MS Basic's instruments that the vocal parts can play instead, to compare. */
export const INSTRUMENTS: [program: number, label: string][] = [
	[DESIGNED, 'Designed'],
	[52, 'Choir Aahs'],
	[53, 'Voice Oohs'],
	[0, 'Piano'],
	[75, 'Pan Flute'],
	[73, 'Flute'],
	[71, 'Clarinet'],
	[68, 'Oboe'],
	[19, 'Church Organ']
];

export type Part = { name: string; vocal: boolean; channels: number[] };

/**
 * Plays a piece's score.mid with its vocal parts on the designed instrument (or another, to
 * compare), and the on-screen keyboard on the same instrument.
 */
export class DesignerSynth extends Synth {
	#parts: Part[];
	/** The channels of the vocal parts that have one. */
	#vocal: number[];
	#program: number;
	#bank: Promise<void>;
	#bankArrived!: () => void;
	/** The score's events and notes, and per channel its CC2 events as [time, value]. */
	events: ScoreEvent[] = [];
	notes: ScoreNote[] = [];
	breath = new Map<number, [number, number][]>();

	constructor(
		parts: Part[],
		duration: number,
		soundfontUrl: (program: number) => string,
		program: number
	) {
		super(duration, soundfontUrl);
		this.#parts = parts;
		this.#vocal = parts.filter((p) => p.vocal && p.channels.length === 1).map((p) => p.channels[0]);
		this.#program = program;
		this.#bank = new Promise((resolve) => (this.#bankArrived = resolve));
	}

	protected arrange(midi: MidiReply): Score {
		this.events = midi.events;
		this.notes = midi.notes;
		for (const { t, data } of midi.events)
			if ((data[0] & 0xf0) === 0xb0 && data[1] === 2) {
				const ch = data[0] & 0x0f;
				if (!this.breath.has(ch)) this.breath.set(ch, []);
				this.breath.get(ch)!.push([t, data[2]]);
			}
		const programs = new Map(midi.programs);
		for (const ch of this.#vocal) programs.set(ch, this.#program);
		return { ...midi, programs };
	}

	async load(midiUrl: string) {
		await super.load(midiUrl);
		// The keyboard sounds as loud, panned and reverberant as the first vocal part.
		const first = this.#vocal[0];
		for (const cc of [7, 10, 91, 93]) {
			const e = this.events.find((e) => e.data[0] === (0xb0 | first) && e.data[1] === cc);
			if (e) this.send([0xb0, cc, e.data[2]], KEYBOARD);
		}
		await this.setProgram(KEYBOARD, this.#program, KEYBOARD_NOTES);
	}

	protected async setProgram(ch: number, program: number, notes?: [number, number][]) {
		if (program !== DESIGNED) return super.setProgram(ch, program, notes);
		await this.#bank;
		this.assign(ch, program);
	}

	/** Gives the synthesizer the designed instrument's bank, or a new version of it. */
	setBank(file: ArrayBuffer, samples: DecodedSample[]) {
		this.addBank('designed', file, samples);
		this.#bankArrived();
	}

	/** Plays the vocal parts and the keyboard with another program. */
	async setVoice(program: number) {
		if (program === this.#program) return;
		this.#program = program;
		if (!this.scored) return;
		try {
			await Promise.all([
				...this.#vocal.map((ch) => this.setProgram(ch, program)),
				this.setProgram(KEYBOARD, program, KEYBOARD_NOTES)
			]);
		} catch (e) {
			this.fail(e);
		}
	}

	setGain(part: string, gain: number) {
		for (const ch of this.#parts.find((p) => p.name === part)?.channels ?? [])
			this.setChannelGain(ch, gain);
	}

	noteOn(key: number, velocity: number) {
		this.send([0x90, key, velocity], KEYBOARD);
	}

	noteOff(key: number) {
		this.send([0x80, key, 0], KEYBOARD);
	}

	/** Sets the keyboard's CC2, which the designed instrument's dynamics follow. */
	breathe(value: number) {
		this.send([0xb0, 2, value], KEYBOARD);
	}
}

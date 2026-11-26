import { Mic } from './mic.svelte.ts';
import { norm, voiceType } from './colors.ts';

/** What carries over from one piece to the next, and what each piece keeps across visits. */
export const METRONOME_LEVELS = [
	'Off',
	'Downbeats only',
	'Regular',
	'Subdivided',
	'Super subdivided'
];

/** The stored metronome level, from the booleans of Metronome and Subdivide that it replaced. */
function storedMetronome() {
	const value = globalThis.localStorage?.getItem('metronome');
	if (value === 'true') return localStorage.getItem('subdivide') === 'true' ? 3 : 2;
	return Number(value) || 0;
}

export class Session {
	readonly mic = new Mic();
	/** Whether a piano doubles the selected parts, so that their notes' starts are easier to hear. */
	extraPiano = $state(true);
	/** The selected parts, and all vocal parts of the piece they were selected in. */
	selected: string[] = $state([]);
	#voices: string[] = [];
	// The default worked on a MacBook with its built-in mic.
	#micDelay = $state(Number(globalThis.localStorage?.getItem('micDelay') ?? 0.12));
	#barSeconds = $state(Number(globalThis.localStorage?.getItem('barSeconds') ?? 10));
	// Choir Aahs.
	#vocalProgram = $state(Number(globalThis.localStorage?.getItem('vocalProgram') ?? 52));
	#metronome = $state(storedMetronome());
	// The level that K turns the metronome back on to.
	#metronomeOn = Number(globalThis.localStorage?.getItem('metronomeOn') ?? (this.#metronome || 2));
	#returnOnPause = $state(globalThis.localStorage?.getItem('returnOnPause') === 'true');
	#emphasis: [number, number] = $state(
		JSON.parse(globalThis.localStorage?.getItem('emphasis') ?? '[0.2, 0.95]')
	);

	/**
	 * How much quieter the other parts are, normally and while "Just me" is on, from 0 to 1. Kept
	 * across visits.
	 */
	get emphasis() {
		return this.#emphasis;
	}
	set emphasis(value: [number, number]) {
		this.#emphasis = value;
		localStorage.setItem('emphasis', JSON.stringify(value));
	}

	/**
	 * Seconds by which the singing reaches the pitch detection late, beyond what the page knows
	 * about. Browsers don't report the input latency, and it depends on the hardware, so the user
	 * sets it. Kept across visits.
	 */
	get micDelay() {
		return this.#micDelay;
	}
	set micDelay(value: number) {
		this.#micDelay = value;
		localStorage.setItem('micDelay', String(value));
	}

	/** The General MIDI program that plays the vocal parts. Kept across visits. */
	get vocalProgram() {
		return this.#vocalProgram;
	}
	set vocalProgram(value: number) {
		this.#vocalProgram = value;
		localStorage.setItem('vocalProgram', String(value));
	}

	/**
	 * How much the metronome clicks, a level of METRONOME_LEVELS: 0 not at all, 1 on downbeats, 2 on
	 * the beats, 3 and 4 also on subdivisions. Kept across visits.
	 */
	get metronome() {
		return this.#metronome;
	}
	set metronome(value: number) {
		this.#metronome = value;
		localStorage.setItem('metronome', String(value));
		if (value) localStorage.setItem('metronomeOn', String((this.#metronomeOn = value)));
	}

	/** Turns the metronome off, or back on to the level it last had. */
	toggleMetronome() {
		this.metronome = this.metronome ? 0 : this.#metronomeOn;
	}

	/** Whether pausing goes back to where playback started. Kept across visits. */
	get returnOnPause() {
		return this.#returnOnPause;
	}
	set returnOnPause(value: boolean) {
		this.#returnOnPause = value;
		localStorage.setItem('returnOnPause', String(value));
	}

	/** Seconds of music across the Pitch view. Kept across visits. */
	get barSeconds() {
		return this.#barSeconds;
	}
	set barSeconds(value: number) {
		this.#barSeconds = value;
		localStorage.setItem('barSeconds', String(value));
	}

	/**
	 * Starts the piece saved under `key`, with these vocal parts: restores the selection and extra
	 * piano saved for it, or else carries them over from the previous piece. Returns what else was
	 * saved for it.
	 */
	enter(key: string, voices: string[]): Partial<Saved> {
		const saved: Saved | null = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null');
		const all = this.#voices.length > 1 && this.selected.length === this.#voices.length;
		const restored = voices.filter((v) => saved?.selected.includes(v));
		const matched = restored.length
			? restored
			: all
				? voices
				: voices.filter((v) => this.selected.some((s) => equivalent(s, voices) === v));
		this.selected = matched.length ? matched : [voices[0]];
		this.#voices = voices;
		this.extraPiano = saved?.extraPiano ?? this.extraPiano;
		return saved ?? {};
	}
}

/** What is kept per piece across visits: also the accompaniment levels and the speed. */
export type Saved = {
	selected: string[];
	extraPiano: boolean;
	levels: Record<string, number>;
	speed: number;
};

const base = (name: string) => norm(name).replace(/\d+/g, '').trim();
/**
 * The part among `names` that corresponds to the part `name` of another piece: the same name, else
 * the first of the same name without its number ("Tenor 2" → "Tenor", "Tenor" → "Tenor 1"), else
 * the first of the same voice type ("Soli Sop 1" → "Soprano", "Baritone" → "Bass").
 */
function equivalent(name: string, names: string[]) {
	const type = voiceType(name);
	return (
		names.find((n) => norm(n) === norm(name)) ??
		names.find((n) => base(n) === base(name)) ??
		(type && names.find((n) => voiceType(n) === type))
	);
}

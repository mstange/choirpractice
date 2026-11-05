import { Mic } from './mic.svelte.ts';

/** What carries over from one piece to the next, and what each piece keeps across visits. */
export class Session {
	readonly mic = new Mic();
	/** How much quieter the other parts are, normally and while "Just me" is held, from 0 to 1. */
	emphasis: [number, number] = $state([0.7, 1]);
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

	/** Seconds of music across the Pitch view. Kept across visits. */
	get barSeconds() {
		return this.#barSeconds;
	}
	set barSeconds(value: number) {
		this.#barSeconds = value;
		localStorage.setItem('barSeconds', String(value));
	}

	/**
	 * Starts the piece saved under `key`, with these vocal parts: restores the selection and the
	 * emphasis and extra piano saved for it, or else carries them over from the previous piece. Returns what else
	 * was saved for it.
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
		// Before "Just me", a piece kept only the normal emphasis.
		const emphasis = saved?.emphasis ?? this.emphasis;
		this.emphasis =
			typeof emphasis === 'number' ? [emphasis, Math.max(emphasis, this.emphasis[1])] : emphasis;
		this.extraPiano = saved?.extraPiano ?? this.extraPiano;
		return saved ?? {};
	}
}

/** What is kept per piece across visits: also the accompaniment levels and the speed. */
export type Saved = {
	selected: string[];
	emphasis: [number, number] | number;
	extraPiano: boolean;
	levels: Record<string, number>;
	speed: number;
};

const norm = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
const base = (name: string) => norm(name).replace(/\d+/g, '').trim();
const TYPES: [RegExp, string][] = [
	[/sop/, 'soprano'],
	[/alt/, 'alto'],
	[/ten/, 'tenor'],
	[/bass|bari/, 'bass']
];
const voiceType = (name: string) => TYPES.find(([re]) => re.test(norm(name)))?.[1];

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

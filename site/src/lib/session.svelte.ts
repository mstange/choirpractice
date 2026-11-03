import { Mic } from './mic.svelte.ts';
import type { View } from './types.ts';

/** What carries over from one piece to the next, and what each piece keeps across visits. */
export class Session {
	readonly mic = new Mic();
	view: View = $state('pitch');
	emphasis = $state(0.7);
	/** The selected parts, and all vocal parts of the piece they were selected in. */
	selected: string[] = $state([]);
	#voices: string[] = [];
	// The default worked on a MacBook with its built-in mic.
	#micDelay = $state(Number(globalThis.localStorage?.getItem('micDelay') ?? 0.12));

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

	/**
	 * Starts the piece saved under `key`, with these vocal parts: restores the selection and the
	 * emphasis saved for it, or else carries them over from the previous piece. Returns the saved
	 * accompaniment levels.
	 */
	enter(key: string, voices: string[]): Record<string, number> {
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
		this.emphasis = saved?.emphasis ?? this.emphasis;
		return saved?.levels ?? {};
	}
}

/** What is kept per piece across visits. */
export type Saved = { selected: string[]; emphasis: number; levels: Record<string, number> };

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

import { Mic } from './mic.svelte.ts';
import type { View } from './types.ts';

/** What carries over from one piece to the next. */
export class Session {
	readonly mic = new Mic();
	view: View = $state('pitch');
	emphasis = $state(0.7);
	/** The selected parts, and all vocal parts of the piece they were selected in. */
	selected: string[] = $state([]);
	#voices: string[] = [];

	/** Carries the selection over to a piece with these vocal parts. */
	enter(voices: string[]) {
		const all = this.#voices.length > 1 && this.selected.length === this.#voices.length;
		const matched = all
			? voices
			: voices.filter((v) => this.selected.some((s) => equivalent(s, voices) === v));
		this.selected = matched.length ? matched : [voices[0]];
		this.#voices = voices;
	}
}

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

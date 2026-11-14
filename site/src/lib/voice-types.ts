// The voice types that an instrument can sing with presets of their own, and which a vocal part is.
import type { Note } from './types.ts';

/**
 * The voice types, each with the median pitch (MIDI) of the section of a recorded choir that it
 * was fitted to: the Choral Singing Dataset's Locus iste (soundfont-designer/scripts/choir/).
 */
export const VOICE_TYPES = [
	{ name: 'soprano', median: 67 },
	{ name: 'alto', median: 62 },
	{ name: 'tenor', median: 57 },
	{ name: 'bass', median: 48 }
] as const;

export type VoiceType = (typeof VOICE_TYPES)[number]['name'];

/**
 * The bank of a vowel's preset (its bank in vowels.ts) for a voice type: 16 banks per voice type,
 * from bank 16 on. An instrument without the voice type's presets plays the vowel's (see
 * presetBank() in synth-engine.ts).
 */
export const voiceBank = (voice: VoiceType, vowelBank: number) =>
	16 * (1 + VOICE_TYPES.findIndex((v) => v.name === voice)) + vowelBank;

/**
 * The voice type of a part by its pitch, whatever its name: the one whose median pitch is nearest
 * the median of the part's notes, weighted by their length. Ranges overlap, so a high alto part
 * sings with the sopranos' presets and a low one with the tenors', of the same register.
 */
export function voiceType(notes: Note[]): VoiceType {
	const sorted = [...notes].sort((a, b) => a.p - b.p),
		total = sorted.reduce((s, n) => s + n.t1 - n.t0, 0);
	let median = sorted.at(-1)?.p ?? 60;
	for (let i = 0, sum = 0; i < sorted.length; i++) {
		sum += sorted[i].t1 - sorted[i].t0;
		if (sum >= total / 2) {
			median = sorted[i].p;
			break;
		}
	}
	return VOICE_TYPES.reduce((best, v) =>
		Math.abs(v.median - median) < Math.abs(best.median - median) ? v : best
	).name;
}

// The sounds that the vocal parts sing, as `p` of piece.json's syllables (see tools/phonemes.py).

/**
 * An instrument that sings vowels has a preset for each, in the bank of its index here, of its
 * one program; bank 0, "ah", is also what an instrument without vowels plays for all of them.
 * New vowels go at the end, so that the banks of exported instruments stay the same.
 *
 * `near` are the vowels that come nearest, in order, for an instrument designed without it.
 */
export const VOWELS = [
	{ ipa: 'a', name: 'ah', word: 'father', near: ['ʌ', 'ɔ'] },
	{ ipa: 'ɛ', name: 'eh', word: 'bed', near: ['e', 'æ'] },
	{ ipa: 'e', name: 'ay', word: 'German See', near: ['ɛ', 'i'] },
	{ ipa: 'i', name: 'ee', word: 'see', near: ['ɪ', 'e'] },
	{ ipa: 'ɪ', name: 'ih', word: 'sit', near: ['i', 'e'] },
	{ ipa: 'o', name: 'oh', word: 'German so', near: ['ɔ', 'u'] },
	{ ipa: 'ɔ', name: 'aw', word: 'law', near: ['o', 'a'] },
	{ ipa: 'u', name: 'oo', word: 'moon', near: ['ʊ', 'o'] },
	{ ipa: 'ʊ', name: 'uu', word: 'book', near: ['u', 'o'] },
	{ ipa: 'ʌ', name: 'uh', word: 'cup', near: ['a', 'ɔ'] },
	{ ipa: 'æ', name: 'ae', word: 'cat', near: ['ɛ', 'a'] },
	{ ipa: 'y', name: 'ue', word: 'German über', near: ['i', 'u'] },
	{ ipa: 'ø', name: 'oe', word: 'German schön', near: ['e', 'o'] },
	{ ipa: 'ɜ', name: 'er', word: 'bird', near: ['ʌ', 'ø'] }
] as const;

export type Ipa = (typeof VOWELS)[number]['ipa'];

/** The bank of each vowel. */
export const VOWEL_BANK = new Map<string, number>(VOWELS.map((v, i) => [v.ipa, i]));

/** The vowels from `ipa` on through their `near`, nearest first, each once. */
export function nearest(ipa: Ipa): Ipa[] {
	const order: Ipa[] = [ipa];
	for (let i = 0; i < order.length; i++)
		for (const n of VOWELS[VOWEL_BANK.get(order[i])!].near) if (!order.includes(n)) order.push(n);
	return order;
}

/** The glides that start a syllable, before its vowel, each with the vowel that it moves from. */
export const GLIDES: Partial<Record<string, Ipa>> = { w: 'u', j: 'i', ɥ: 'y' };

/** The other consonants of a syllable's phonemes, each one character: ʧ, ʤ, ʦ, ʣ are affricates. */
export const CONSONANTS = 'pbtdkgfvθðszʃʒhmnŋɲlrʧʤʦʣ';

/** The vowels of a syllable's phonemes: none, one, or a diphthong's two. */
export const vowelsOf = (phonemes: string | undefined) =>
	[...(phonemes ?? '')].filter((c): c is Ipa => VOWEL_BANK.has(c));

/** The glide that a syllable's phonemes start their vowel with, as the vowel it moves from. */
export function glideOf(phonemes: string | undefined): Ipa | undefined {
	const chars = [...(phonemes ?? '')],
		i = chars.findIndex((c) => VOWEL_BANK.has(c));
	return i > 0 ? GLIDES[chars[i - 1]] : undefined;
}

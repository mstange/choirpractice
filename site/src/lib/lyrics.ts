import type { Syllable } from './types.ts';

const LINE_GAP = 0.5; // seconds of silence that start a new line
const MERGE_GAP = 2; // fragments separated by shorter rests are joined if they fit on one line
const MAX_LINE_CHARS = 42; // even if a longer line would fit, it's harder to read

export interface Line {
	sylls: Syllable[];
	text: string;
	t0: number;
	t1: number;
}

type Word = Syllable[];

// A syllable continues the previous word if that one was tagged begin/middle. Looking at the
// previous syllable rather than the current one tolerates scores where a word's last syllable
// was mistakenly entered as "single".
export const startsWord = (sylls: Syllable[], i: number) =>
	i === 0 || sylls[i - 1].syl === 's' || sylls[i - 1].syl === 'e';

function words(sylls: Syllable[]): Word[] {
	const out: Word[] = [];
	sylls.forEach((s, i) => (startsWord(sylls, i) ? out.push([s]) : out[out.length - 1].push(s)));
	return out;
}

const wordText = (w: Word) => w.map((s) => s.text).join('');
const phraseLength = (ws: Word[]) => ws.reduce((n, w) => n + wordText(w).length + 1, -1);
const phraseText = (ws: Word[]) => ws.map(wordText).join(' ');
/** Whether a line's text fits the width available for it. */
export type Fits = (text: string) => boolean;

// Split an over-long phrase at the word boundary that best combines "close to the middle" with
// "after punctuation" or "before a capitalized verse start".
function splitLong(ws: Word[], ok: (ws: Word[]) => boolean): Word[][] {
	if (ws.length < 2 || ok(ws)) return [ws];
	const total = phraseLength(ws);
	let best = 1,
		bestScore = -Infinity,
		pos = 0;
	for (let i = 1; i < ws.length; i++) {
		pos += wordText(ws[i - 1]).length + 1;
		const next = wordText(ws[i]);
		const score =
			(/[;,.!?:]$/.test(wordText(ws[i - 1])) ? 12 : 0) +
			(/^[A-Z]/.test(next) && next !== 'I' ? 8 : 0) -
			Math.abs(pos - total / 2);
		if (score > bestScore) [best, bestScore] = [i, score];
	}
	return [...splitLong(ws.slice(0, best), ok), ...splitLong(ws.slice(best), ok)];
}

export function splitLines(sylls: Syllable[], fits: Fits): Line[] {
	const ok = (ws: Word[]) => phraseLength(ws) <= MAX_LINE_CHARS && fits(phraseText(ws));
	const endsSentence = (ws: Word[]) => /[.;!?]$/.test(wordText(ws[ws.length - 1]));
	const gapBetween = (a: Word[], b: Word[]) => b[0][0].t0 - a[a.length - 1].at(-1)!.t1;
	// Break at rests and sentence ends, then re-join short fragments separated by brief rests.
	const phrases: Word[][] = [];
	for (const w of words(sylls)) {
		const cur = phrases.at(-1);
		if (!cur || endsSentence(cur) || gapBetween(cur, [w]) > LINE_GAP) phrases.push([w]);
		else cur.push(w);
	}
	const merged: Word[][] = [];
	for (const p of phrases) {
		const prev = merged.at(-1);
		if (prev && !endsSentence(prev) && gapBetween(prev, p) < MERGE_GAP && ok([...prev, ...p]))
			prev.push(...p);
		else merged.push(p);
	}
	return merged
		.flatMap((ws) => splitLong(ws, ok))
		.map((ws) => {
			const sylls = ws.flat();
			return { sylls, text: phraseText(ws), t0: sylls[0].t0, t1: sylls[sylls.length - 1].t1 };
		});
}

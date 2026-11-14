// Aligns the Choral Singing Dataset's note annotations of Locus iste (per section: onset, mean f0,
// duration) with the score's notes in media/csd/locus-iste/piece.json, by their pitch sequences,
// so that each recorded note gets its syllable and vowel, and writes them to .dev/choir/notes.json.
//
// Usage: node scripts/choir/align.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { SECTIONS, csd, notesPath, root } from './data.ts';

const piece = JSON.parse(readFileSync(`${root}media/csd/locus-iste/piece.json`, 'utf8'));

type ScoreNote = { t0: number; t1: number; p: number; s: number };
type Syllable = { text: string; v?: string };

const out: Record<string, unknown[]> = {};
for (const [i, section] of SECTIONS.entries()) {
	const voice = piece.voices[i] as { name: string; notes: ScoreNote[]; syllables: Syllable[] };
	const rec = readFileSync(`${csd}/CSD_LI_${section}_notes.lab`, 'utf8')
		.trim()
		.split('\n')
		.map((l) => {
			const [t, f, d] = l.trim().split(/\s+/).map(Number);
			return { t, d, f, midi: 69 + 12 * Math.log2(f / 440) };
		});
	const score = voice.notes;
	// Needleman–Wunsch: a match costs the pitch difference in semitones, a skipped note 1.5. A
	// tied or repeated score note may be one recorded note, which a skip of the score note covers.
	const n = rec.length,
		m = score.length,
		GAP = 1.5,
		cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1)),
		move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
	for (let a = 0; a <= n; a++)
		for (let b = 0; b <= m; b++) {
			if (!a && !b) continue;
			let best = Infinity,
				dir = 0;
			if (a && b) {
				const c = cost[a - 1][b - 1] + Math.abs(rec[a - 1].midi - score[b - 1].p);
				if (c < best) [best, dir] = [c, 1];
			}
			if (a && cost[a - 1][b] + GAP < best) [best, dir] = [cost[a - 1][b] + GAP, 2];
			if (b && cost[a][b - 1] + GAP < best) [best, dir] = [cost[a][b - 1] + GAP, 3];
			cost[a][b] = best;
			move[a][b] = dir;
		}
	const pairs: [number, number][] = [];
	for (let a = n, b = m; a || b;) {
		const dir = move[a][b];
		if (dir === 1) pairs.push([--a, --b]);
		else if (dir === 2) a--;
		else b--;
	}
	pairs.reverse();
	const notes = pairs.map(([a, b]) => {
		const syl = voice.syllables[score[b].s];
		return {
			t: rec[a].t,
			d: rec[a].d,
			f0: rec[a].f,
			key: score[b].p,
			off: Math.round((rec[a].midi - score[b].p) * 100),
			text: syl.text,
			v: syl.v ?? null,
			// Whether the note starts its syllable: the first note of a melisma has the consonant.
			first: b === 0 || score[b - 1].s !== score[b].s
		};
	});
	const bad = notes.filter((x) => Math.abs(x.off) > 50);
	console.log(
		`${section}: ${n} recorded, ${m} in the score, ${notes.length} matched, ${bad.length} off by more than a quarter tone` +
			(bad.length ? `: ${bad.map((x) => `${x.t.toFixed(1)}s ${x.off}c`).join(', ')}` : '')
	);
	const vowels = new Map<string, number>();
	for (const x of notes) vowels.set(x.v ?? '-', (vowels.get(x.v ?? '-') ?? 0) + x.d);
	console.log(
		'  seconds per vowel: ' +
			[...vowels]
				.sort((a, b) => b[1] - a[1])
				.map(([v, s]) => `${v} ${s.toFixed(1)}`)
				.join(', ')
	);
	out[section] = notes;
}
writeFileSync(notesPath, JSON.stringify(out, null, 1));

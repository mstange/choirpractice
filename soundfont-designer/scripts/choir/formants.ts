// Fits the formants of each vowel that the Choral Singing Dataset's sections sing in Locus iste,
// as the designer's Sing fits a vowel sung into the microphone (sung.ts): per section, the frames
// of its four microphones mixed, on the notes of the vowel. Then the ratios of each vowel's F1 to
// F3 to the section's "ah", which the patch keeps for a sung vowel, and writes a patch with them.
//
// Usage: node scripts/choir/formants.ts base-patch.json out-patch.json
import { readFileSync, writeFileSync } from 'node:fs';
import { assess, frameAt, frameSamples, type Frame } from '../../src/lib/sung.ts';
import { complete } from '../../src/lib/patch.ts';
import { SECTIONS, readNotes, sectionMix } from './data.ts';

const notes = readNotes();
const [basePath, outPath] = process.argv.slice(2);

const VOWELS = ['a', 'ɛ', 'ɔ', 'i', 'u'];
const found: Record<string, Record<string, number[]>> = {};
for (const section of SECTIONS) {
	const { mix, rate } = sectionMix(section),
		{ hop, window } = frameSamples(rate);
	found[section] = {};
	const line: string[] = [];
	for (const vowel of VOWELS) {
		// The notes' frames one after another, as if sung in one go, without the consonants.
		const frames: Frame[] = [];
		let t = 0;
		for (const n of notes[section].filter((n) => n.v === vowel)) {
			const from = Math.round((n.t + 0.15) * rate),
				to = Math.round((n.t + n.d - 0.1) * rate);
			for (let s = from; s + window <= to; s += hop, t += hop / rate) {
				const f = frameAt(mix, rate, s, t);
				if (f) frames.push(f);
			}
		}
		const fit = assess(frames);
		found[section][vowel] = fit.formants;
		line.push(
			`${vowel} ${fit.formants.join('/')} (${fit.error.toFixed(1)} dB, ${fit.frames} frames, ${fit.stray.length} stretches out` +
				(fit.times
					? `, halves ${fit.times.map((f) => f.join('/')).join(' ')}`
					: ', bands not covered twice') +
				')'
		);
	}
	console.log(`${section}:\n  ${line.join('\n  ')}`);
}

// Each vowel's ratios to "ah", per section, and their median over the sections.
const patch = complete(JSON.parse(readFileSync(basePath, 'utf8')));
console.log('\nratios to "ah" (F1 F2 F3):');
for (const vowel of VOWELS.slice(1)) {
	const per = SECTIONS.map((s) => found[s][vowel].map((f, i) => f / found[s].a[i])),
		// The median of the four, the mean of the middle two, which leaves out a section's fit
		// that went astray (soprano ɔ came out with F1 at 181 Hz, tenor ɔ with F2 at 2640 Hz).
		mean = [0, 1, 2].map((i) => {
			const r = per.map((x) => x[i]).sort((x, y) => x - y);
			return Math.sqrt(r[1] * r[2]);
		});
	console.log(
		`  ${vowel}: ${per.map((r, k) => `${SECTIONS[k]} ${r.map((x) => x.toFixed(2)).join(' ')}`).join(', ')}; median ${mean.map((x) => x.toFixed(2)).join(' ')}`
	);
	patch.vowels[vowel as keyof typeof patch.vowels] = {
		vowel: 'sung',
		sung: mean.map((x) => Math.round(x * 100) / 100),
		// No formants in Hz: a section's are those of four voices and one microphone, and a vowel
		// that the user sings later is measured against the user's own "ah", not the choir's.
		measured: []
	};
}
if (outPath) writeFileSync(outPath, JSON.stringify(patch, null, 1));

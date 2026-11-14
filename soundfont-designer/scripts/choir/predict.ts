// The harmonics of a patch's tone as the synthesizer plays them, predicted from its spectrum
// without rendering, for fitting: a key plays the sample of its zone's root, transposed, and the
// ensemble and the noise leave each harmonic's power as the spectrum has it.
import { keyFreq } from '../../src/lib/dsp.ts';
import { db, type Harmonic } from '../../src/lib/measure.ts';
import { zones } from '../../src/lib/build.ts';
import type { Patch, VowelFormants } from '../../src/lib/patch.ts';
import { toneHarmonics } from '../../src/lib/spectrum.ts';

/** The power of each harmonic of the patch's tone on `key`, singing `formants`. */
export function predict(p: Patch, key: number, formants: VowelFormants): Harmonic[] {
	const root = zones(p.output.spacing).find((z) => key >= z.min && key <= z.max)!.root;
	return toneHarmonics(p, root, keyFreq(root), p.output.sampleRate, formants).map((h) => ({
		level: h.amp ** 2,
		noise: 0,
		cents: 0
	}));
}

/**
 * How far `ours[k]` is from `theirs[k]`, in dB rms per harmonic, with the best offset for each
 * key, over the harmonics that fitContour() fits: those of `theirs` above its noise and within
 * 50 dB of its strongest, where ours are within 70 dB of our strongest. With `perKey`, also the
 * error of each key.
 */
export function misfit(theirs: Harmonic[][], ours: Harmonic[][]) {
	let sum = 0,
		count = 0;
	const perKey = theirs.map((t, k) => {
		const top = Math.max(...t.map((h) => h.level)),
			ourTop = Math.max(...ours[k].map((h) => h.level)),
			e: number[] = [];
		t.forEach((h, i) => {
			const o = ours[k][i];
			if (!o || h.level <= h.noise || db(h.level / top) < -50 || db(o.level / ourTop) < -70) return;
			e.push(db(h.level) - db(o.level));
		});
		if (!e.length) return NaN;
		const m = e.reduce((s, v) => s + v, 0) / e.length,
			sq = e.reduce((s, v) => s + (v - m) ** 2, 0);
		sum += sq;
		count += e.length;
		return Math.sqrt(sq / e.length);
	});
	return { rms: Math.sqrt(sum / count), perKey };
}

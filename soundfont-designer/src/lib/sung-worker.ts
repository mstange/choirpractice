// Fits the formants of a recorded vowel off the main thread, and again on its lower and upper
// pitches apart, to tell how far the formants depend on which of the pitches went into the fit.
import { analyse, fitFormants } from './sung.ts';

export type SungRequest = { x: Float32Array; rate: number };
export type SungReply = {
	formants: number[];
	error: number;
	/** The largest difference of F1 to F3 between the lower and upper pitches' fits, against the whole's. */
	spread: number;
	frames: number;
	low: number;
	high: number;
};

onmessage = ({ data: { x, rate } }: MessageEvent<SungRequest>) => {
	const frames = analyse(x, rate),
		midi = frames.map((f) => f.midi);
	if (!frames.length) {
		postMessage({ formants: [], error: Infinity, spread: Infinity, frames: 0, low: 0, high: 0 });
		return;
	}
	const whole = fitFormants(frames),
		median = midi.toSorted((a, b) => a - b)[frames.length >> 1],
		lower = fitFormants(frames.filter((f) => f.midi < median)).formants,
		upper = fitFormants(frames.filter((f) => f.midi >= median)).formants;
	postMessage({
		...whole,
		spread: Math.max(...whole.formants.map((f, i) => Math.abs(lower[i] - upper[i]) / f)),
		frames: frames.length,
		low: Math.min(...midi),
		high: Math.max(...midi)
	} satisfies SungReply);
};

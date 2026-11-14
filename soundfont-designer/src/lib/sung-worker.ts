// Fits the formants of a recorded vowel off the main thread.
import { analyse, fitFormants } from './sung.ts';

export type SungRequest = { x: Float32Array; rate: number };
export type SungReply = {
	formants: number[];
	error: number;
	frames: number;
	low: number;
	high: number;
};

onmessage = ({ data: { x, rate } }: MessageEvent<SungRequest>) => {
	const frames = analyse(x, rate),
		midi = frames.map((f) => f.midi);
	postMessage({
		...(frames.length ? fitFormants(frames) : { formants: [], error: Infinity }),
		frames: frames.length,
		low: Math.min(...midi),
		high: Math.max(...midi)
	} satisfies SungReply);
};

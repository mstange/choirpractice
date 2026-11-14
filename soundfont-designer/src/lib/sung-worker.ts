// Fits the formants of a vowel off the main thread while it is being sung: the page sends the
// recording as it comes, and gets the fit of what has been sung so far about once a second of
// audio, and the final fit once the recording ends.
import { assess, frameAt, frameSamples, type Frame } from './sung.ts';

export type SungRequest = { rate: number } | { x: Float32Array } | { end: true };
export type Assessment = ReturnType<typeof assess>;
export type SungReply = {
	final: boolean;
	/** The fit, once there are enough frames. */
	fit: Assessment | null;
	/** Whether F1 to F3 changed by less than `STEADY` since a second of audio ago. */
	steady: boolean;
};

/** The frames that a fit needs at least, and the largest change of a formant that is steady. */
const FEWEST = 10,
	STEADY = 0.03;

let rate = 48000,
	x = new Float32Array(0),
	length = 0,
	analysed = 0,
	fitted = 0;
const frames: Frame[] = [],
	/** The formants of each fit so far, with the seconds of audio that it had. */
	history: [number, number[]][] = [];

function add(chunk: Float32Array) {
	if (length + chunk.length > x.length) {
		const bigger = new Float32Array(Math.max(2 * x.length, length + chunk.length));
		bigger.set(x.subarray(0, length));
		x = bigger;
	}
	x.set(chunk, length);
	length += chunk.length;
	const { hop, window } = frameSamples(rate);
	for (; analysed + window <= length; analysed += hop) {
		const f = frameAt(x, rate, analysed, analysed / rate);
		if (f) frames.push(f);
	}
}

function reply(final: boolean) {
	const fit = frames.length >= FEWEST ? assess(frames, history.at(-1)?.[1]) : null,
		seconds = length / rate;
	let steady = false;
	if (fit) {
		const before = history.findLast(([t]) => t <= seconds - 1)?.[1];
		steady = !!before && fit.formants.every((f, i) => Math.abs(f / before[i] - 1) < STEADY);
		history.push([seconds, fit.formants]);
	}
	postMessage({ final, fit, steady } satisfies SungReply);
}

onmessage = ({ data }: MessageEvent<SungRequest>) => {
	if ('rate' in data) rate = data.rate;
	else if ('x' in data) {
		add(data.x);
		if (length - fitted >= rate) {
			fitted = length;
			reply(false);
		}
	} else reply(true);
};

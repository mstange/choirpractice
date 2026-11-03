import { detectPitch } from './pitch.ts';

const WINDOW = 2048; // samples per pitch estimate; at least two periods of the lowest pitch

/** Microphone input, analysed for pitch whenever `read` is called. */
export class Mic {
	active = $state(false);
	error = $state('');
	#stream?: MediaStream;
	#ctx?: AudioContext;
	#analyser?: AnalyserNode;
	#buf = new Float32Array(WINDOW);

	async start() {
		this.error = '';
		try {
			// Noise suppression treats sustained tones as noise, and gain control has no effect on
			// pitch. Echo cancellation keeps the playback out of the pitch when not using headphones.
			this.#stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false }
			});
		} catch (e) {
			this.error = String((e as Error).message ?? e);
			return;
		}
		// A context of its own: a MediaStream source must run at the stream's sample rate.
		this.#ctx = new AudioContext();
		this.#analyser = new AnalyserNode(this.#ctx, { fftSize: WINDOW });
		this.#ctx.createMediaStreamSource(this.#stream).connect(this.#analyser);
		this.active = true;
	}

	stop() {
		for (const track of this.#stream?.getTracks() ?? []) track.stop();
		this.#ctx?.close();
		this.#stream = this.#ctx = this.#analyser = undefined;
		this.active = false;
	}

	/** How far the middle of the analysed window lags behind the input, in seconds. */
	get delay() {
		return this.#ctx ? WINDOW / 2 / this.#ctx.sampleRate : 0;
	}

	/** The MIDI pitch of the latest input, or null if there is no clear pitch. */
	read(): number | null {
		if (!this.#analyser || !this.#ctx) return null;
		this.#analyser.getFloatTimeDomainData(this.#buf);
		return detectPitch(this.#buf, this.#ctx.sampleRate);
	}
}

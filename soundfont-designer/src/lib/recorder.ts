// Records the microphone as it is, for measuring a sung vowel's spectrum: without echo
// cancellation, noise suppression or gain control, which would each change the spectrum.
import { detectPitch } from '../../../site/src/lib/pitch.ts';
import workletUrl from './recorder-worklet.ts?worker&url';

export class Recorder {
	#stream?: MediaStream;
	#ctx?: AudioContext;
	#node?: AudioWorkletNode;
	#analyser?: AnalyserNode;
	#buf = new Float32Array(2048);

	async open() {
		if (this.#ctx) return;
		this.#stream = await navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
		});
		// A context of its own: a MediaStream source must run at the stream's sample rate.
		this.#ctx = new AudioContext();
		await this.#ctx.audioWorklet.addModule(workletUrl);
		const source = this.#ctx.createMediaStreamSource(this.#stream);
		this.#node = new AudioWorkletNode(this.#ctx, 'recorder');
		this.#analyser = new AnalyserNode(this.#ctx, { fftSize: this.#buf.length });
		source.connect(this.#node);
		source.connect(this.#analyser);
	}

	close() {
		for (const track of this.#stream?.getTracks() ?? []) track.stop();
		this.#ctx?.close();
		this.#stream = this.#ctx = this.#node = this.#analyser = undefined;
	}

	get rate() {
		return this.#ctx?.sampleRate ?? 48000;
	}

	#chunks: Float32Array[] = [];

	/** Starts recording the input. */
	start() {
		this.#chunks = [];
		this.#node!.port.onmessage = ({ data }: MessageEvent<Float32Array>) => this.#chunks.push(data);
		this.#node!.port.postMessage(true);
	}

	/** Stops recording, and gives the input since `start()`. */
	stop() {
		this.#node!.port.postMessage(false);
		this.#node!.port.onmessage = null;
		const x = new Float32Array(this.#chunks.reduce((n, c) => n + c.length, 0));
		let at = 0;
		for (const c of this.#chunks) x.set(c, (at += c.length) - c.length);
		this.#chunks = [];
		return x;
	}

	/** The MIDI pitch of the latest input, or null if it has no clear pitch. */
	pitch() {
		if (!this.#analyser) return null;
		this.#analyser.getFloatTimeDomainData(this.#buf);
		return detectPitch(this.#buf, this.rate);
	}
}

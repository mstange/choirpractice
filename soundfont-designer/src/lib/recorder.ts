// Records the microphone as it is, for measuring a sung vowel's spectrum: without echo
// cancellation, noise suppression or gain control, which would each change the spectrum.
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

	/** The latest 2048 samples of the input. */
	latest() {
		this.#analyser?.getFloatTimeDomainData(this.#buf);
		return this.#buf;
	}
}

/** `x` as a 16-bit WAV file. */
export function wav(x: Float32Array, rate: number) {
	const b = new DataView(new ArrayBuffer(44 + 2 * x.length)),
		text = (at: number, s: string) => [...s].forEach((c, i) => b.setUint8(at + i, c.charCodeAt(0)));
	text(0, 'RIFF');
	b.setUint32(4, 36 + 2 * x.length, true);
	text(8, 'WAVEfmt ');
	b.setUint32(16, 16, true);
	b.setUint16(20, 1, true); // PCM
	b.setUint16(22, 1, true); // mono
	b.setUint32(24, rate, true);
	b.setUint32(28, 2 * rate, true);
	b.setUint16(32, 2, true);
	b.setUint16(34, 16, true);
	text(36, 'data');
	b.setUint32(40, 2 * x.length, true);
	x.forEach((v, i) =>
		b.setInt16(44 + 2 * i, Math.round(32767 * Math.max(-1, Math.min(1, v))), true)
	);
	return new Blob([b], { type: 'audio/wav' });
}

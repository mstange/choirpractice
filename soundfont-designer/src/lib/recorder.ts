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

	/** Plays a soft tone at `midi` for `seconds`, to start from, and resolves when it has ended. */
	cue(midi: number, seconds: number) {
		const ctx = this.#ctx!,
			t = ctx.currentTime,
			osc = new OscillatorNode(ctx, { type: 'triangle', frequency: 440 * 2 ** ((midi - 69) / 12) }),
			gain = new GainNode(ctx, { gain: 0 });
		gain.gain.setTargetAtTime(0.15, t, 0.02);
		gain.gain.setTargetAtTime(0, t + seconds - 0.1, 0.02);
		osc.connect(gain).connect(ctx.destination);
		osc.start(t);
		osc.stop(t + seconds);
		return new Promise<void>((resolve) => (osc.onended = () => resolve()));
	}

	/** The input of the next `seconds`. */
	record(seconds: number) {
		const node = this.#node!,
			chunks: Float32Array[] = [];
		node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => chunks.push(data);
		node.port.postMessage(true);
		return new Promise<Float32Array>((resolve) =>
			setTimeout(() => {
				node.port.postMessage(false);
				node.port.onmessage = null;
				const x = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
				let at = 0;
				for (const c of chunks) x.set(c, (at += c.length) - c.length);
				resolve(x);
			}, seconds * 1000)
		);
	}

	/** The MIDI pitch of the latest input, or null if it has no clear pitch. */
	pitch() {
		if (!this.#analyser) return null;
		this.#analyser.getFloatTimeDomainData(this.#buf);
		return detectPitch(this.#buf, this.rate);
	}
}

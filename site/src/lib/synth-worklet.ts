// The audio thread's side of the synthesizer: an AudioWorkletProcessor around the Engine.
import { Engine, type Message } from './synth-engine.ts';

// The globals of the AudioWorkletGlobalScope, which TypeScript has no declarations for.
declare const sampleRate: number;
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

registerProcessor(
	'synth',
	class extends AudioWorkletProcessor {
		#engine = new Engine(sampleRate);

		constructor() {
			super();
			this.port.onmessage = (e: MessageEvent<Message>) => this.#engine.receive(e.data);
		}

		process(_inputs: Float32Array[][], [[left, right]]: Float32Array[][]) {
			this.#engine.render(left, right);
			return true;
		}
	}
);

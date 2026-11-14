// Passes the microphone's input to the page, block by block, while it is recording.

// The globals of the AudioWorkletGlobalScope, which TypeScript has no declarations for.
declare class AudioWorkletProcessor {
	readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

registerProcessor(
	'recorder',
	class extends AudioWorkletProcessor {
		recording = false;
		constructor() {
			super();
			this.port.onmessage = ({ data }: MessageEvent<boolean>) => (this.recording = data);
		}
		process([input]: Float32Array[][]) {
			if (this.recording && input[0]) this.port.postMessage(input[0].slice());
			return true;
		}
	}
);

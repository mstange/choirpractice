// Safari's Audio Session API, which TypeScript has no declarations for.
interface Navigator {
	audioSession?: { type: 'auto' | 'playback' | 'play-and-record' | (string & {}) };
}

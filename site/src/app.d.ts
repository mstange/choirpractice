// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	/** Safari's Audio Session API, not in TypeScript's DOM types yet. */
	interface Navigator {
		audioSession?: { type: 'auto' | 'playback' | 'play-and-record' | (string & {}) };
	}
}

export {};

interface ImportMetaEnv {
	/** Base URL of the seasons' directories, for deployed pages (see src/lib/pieces.ts). */
	readonly VITE_MEDIA_BASE?: string;
}

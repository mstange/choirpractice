// Compresses a sound bank's samples to Ogg Vorbis, as an SF3 file has them. Browsers have no Vorbis
// encoder, so this is libvorbis compiled to WebAssembly (wasm-media-encoders), loaded only when
// a file is exported.
import type { BasicSoundBank } from 'spessasynth_core';

/** libvorbis's VBR quality, from -1 to 10. At 5 the default patch is about as big as Choir Aahs. */
export const QUALITY = 5;

/** Compresses `bank`'s samples in place; its writeSF2() then writes an SF3 file. */
export async function compress(bank: BasicSoundBank, quality = QUALITY) {
	const { createOggEncoder } = await import('wasm-media-encoders');
	const encoder = await createOggEncoder();
	await bank.setSampleFormat({
		format: 'compressed',
		rejectOnFailure: true,
		compressionFunction: async (pcm, sampleRate) => {
			// configure() starts a new stream; the output is a view of the encoder's memory.
			encoder.configure({ channels: 1, sampleRate, vbrQuality: quality });
			const head = encoder.encode([pcm]).slice(),
				tail = encoder.finalize();
			const out = new Uint8Array(head.length + tail.length);
			out.set(head);
			out.set(tail, head.length);
			return out;
		}
	});
}

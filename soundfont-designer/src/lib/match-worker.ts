// Matches a patch's contour to one of MS Basic's instruments, off the main thread.
import { BasicSoundBank, SoundBankLoader } from 'spessasynth_core';
import { matchContour } from './measure.ts';
import type { Patch } from './patch.ts';

export type MatchRequest = { patch: Patch; program: number; url: string };
export type MatchReply = { contour: number[]; before: number; after: number } | { error: string };

onmessage = async ({ data: { patch, program, url } }: MessageEvent<MatchRequest>) => {
	try {
		const r = await fetch(url);
		if (!r.ok) throw new Error(`${url}: ${r.status}`);
		await BasicSoundBank.ready;
		const reference = SoundBankLoader.fromArrayBuffer(await r.arrayBuffer());
		postMessage(matchContour(reference, program, patch) satisfies MatchReply);
	} catch (e) {
		postMessage({ error: String((e as Error).message ?? e) } satisfies MatchReply);
	}
};

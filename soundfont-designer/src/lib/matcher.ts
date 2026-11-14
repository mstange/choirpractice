import type { MatchReply, MatchRequest } from './match-worker.ts';
import type { Patch } from './patch.ts';

/** Matches `patch`'s contour to the instrument at `program` of media/soundfont/, in a worker. */
export function match(patch: Patch, program: number): Promise<MatchReply> {
	const worker = new Worker(new URL('./match-worker.ts', import.meta.url), { type: 'module' });
	const url = new URL(`media/soundfont/${program}.sf3`, location.href).href;
	return new Promise((resolve) => {
		worker.onmessage = ({ data }: MessageEvent<MatchReply>) => {
			worker.terminate();
			resolve(data);
		};
		worker.postMessage({ patch, program, url } satisfies MatchRequest);
	});
}

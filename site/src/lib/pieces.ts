import type { PieceEntry } from './types.ts';

/** Where the seasons' directories are: the media/ directory next to the page, unless configured. */
const BASE = import.meta.env.VITE_MEDIA_BASE ?? 'media';

/** URL of a file in a season's directory (written by tools/build.sh, so not known statically). */
export const mediaUrl = (season: string, file: string) => `${BASE}/${season}/${file}`;

/** The pieces of a season, from its pieces.json, or undefined if there is no such season. */
export async function loadSeason(
	season: string,
	fetch: typeof globalThis.fetch
): Promise<PieceEntry[] | undefined> {
	const res = await fetch(mediaUrl(season, 'pieces.json'));
	if (res.status === 404 || res.status === 403) return;
	if (!res.ok) throw new Error(`${res.url}: ${res.status} ${res.statusText}`);
	return res.json();
}

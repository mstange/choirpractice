import { MEDIA_BASE, MEDIA_CACHE } from './media.ts';
import type { Season } from './types.ts';

export { MEDIA_CACHE };

/** URL of a file in a season's directory (written by tools/build.sh, so not known statically). */
export const mediaUrl = (season: string, file: string) => `${MEDIA_BASE}/${season}/${file}`;

/** A season's pieces.json, or undefined if there is no such season. */
export async function loadSeason(
	season: string,
	fetch: typeof globalThis.fetch
): Promise<Season | undefined> {
	const res = await fetch(mediaUrl(season, 'pieces.json'));
	if (res.status === 404 || res.status === 403) return;
	if (!res.ok) throw new Error(`${res.url}: ${res.status} ${res.statusText}`);
	return res.json();
}

/** The seasons opened before, most recent first, kept in localStorage. */
export function visitedSeasons(): string[] {
	return JSON.parse(globalThis.localStorage?.getItem('seasons') ?? '[]');
}

/** Puts a season first among the visited ones. The demo is linked from the start page anyway. */
export function rememberSeason(season: string) {
	if (season === 'demo') return;
	const seasons = [season, ...visitedSeasons().filter((s) => s !== season)];
	localStorage.setItem('seasons', JSON.stringify(seasons));
}

/** Forgets a season, and deletes its files from the media cache. */
export async function forgetSeason(season: string) {
	localStorage.setItem('seasons', JSON.stringify(visitedSeasons().filter((s) => s !== season)));
	setSavedOffline(season, false);
	const cache = await caches.open(MEDIA_CACHE);
	const prefix = new URL(mediaUrl(season, ''), document.baseURI).href;
	for (const req of await cache.keys()) if (req.url.startsWith(prefix)) await cache.delete(req);
}

/** The seasons saved for offline use, kept in localStorage. */
export function savedOffline(): string[] {
	return JSON.parse(globalThis.localStorage?.getItem('offline') ?? '[]');
}

export function setSavedOffline(season: string, saved: boolean) {
	const seasons = savedOffline().filter((s) => s !== season);
	localStorage.setItem('offline', JSON.stringify(saved ? [...seasons, season] : seasons));
}

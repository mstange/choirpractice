import { INSTRUMENTS, soundfontFile } from './instruments.ts';
import { loadSeason, MEDIA_CACHE, mediaUrl, setSavedOffline } from './pieces.ts';
import { programsUsed } from './choir-synth.ts';
import type { PieceData } from './types.ts';

/**
 * Puts every file that a season's pieces need into the media cache, which the service worker falls
 * back on offline: the pieces' data, sheet music and MIDI files, the soundfont files they play,
 * and those of all instruments of the menu. Calls `progress` with the number of files done so far
 * and the number known so far.
 */
export async function saveOffline(season: string, progress: (done: number, total: number) => void) {
	const cache = await caches.open(MEDIA_CACHE);
	let done = 0,
		total = 0;
	const save = async (url: string) => {
		progress(done, ++total);
		const res = await fetch(url, { cache: 'no-cache' });
		if (!res.ok) throw new Error(`${res.url}: ${res.status} ${res.statusText}`);
		await cache.put(new URL(url, document.baseURI).href, res.clone());
		progress(++done, total);
		return res;
	};
	const { parseMidi } = await import('./midi.ts');
	const loaded = await loadSeason(season, fetch);
	if (!loaded) throw new Error('This season is no longer there.');
	await save(mediaUrl(season, 'pieces.json'));
	const programs = new Set(INSTRUMENTS.map(([program]) => program));
	await Promise.all(
		loaded.pieces.map(async ({ slug }) => {
			const url = (file: string) => mediaUrl(season, `${slug}/${file}`);
			const piece: PieceData = await (await save(url('piece.json'))).json();
			const midi = parseMidi(await (await save(url('score.mid'))).arrayBuffer());
			for (const program of programsUsed(piece.parts, midi.programs, INSTRUMENTS[0][0]))
				programs.add(program);
			await Promise.all(piece.engravings.map((e) => save(url(e.file))));
		})
	);
	await Promise.all([...programs].map((p) => save(mediaUrl('soundfont', soundfontFile(p)))));
	setSavedOffline(season, true);
}

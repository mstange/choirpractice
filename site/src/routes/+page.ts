import { forgetSeason, loadSeason, visitedSeasons } from '#lib/pieces.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const seasons = await Promise.all(
		visitedSeasons().map(async (season) => {
			const loaded = await loadSeason(season, fetch).catch(() => null);
			// A season that is gone for good (a 404) is forgotten; one that didn't load is kept.
			if (loaded === undefined) forgetSeason(season);
			return { season, loaded };
		})
	);
	return { seasons: seasons.filter((s) => s.loaded !== undefined) };
};

import { forgetSeason, loadSeason, visitedSeasons } from '#lib/pieces.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const seasons = await Promise.all(
		visitedSeasons().map(async (season) => {
			const pieces = await loadSeason(season, fetch).catch(() => null);
			// A season that is gone for good (a 404) is forgotten; one that didn't load is kept.
			if (pieces === undefined) forgetSeason(season);
			return { season, pieces };
		})
	);
	return { seasons: seasons.filter((s) => s.pieces !== undefined) };
};

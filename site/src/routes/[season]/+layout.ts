import { error } from '@sveltejs/kit';
import { loadSeason, rememberSeason } from '#lib/pieces.ts';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ params, fetch }) => {
	const loaded = await loadSeason(params.season, fetch);
	if (!loaded) error(404, 'This link doesn’t lead anywhere. Ask your choir for the current one.');
	rememberSeason(params.season);
	return { season: params.season, ...loaded };
};

import { error } from '@sveltejs/kit';
import { mediaUrl } from '#lib/pieces.ts';
import type { PieceData } from '#lib/types.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, parent, fetch }) => {
	const { season, pieces } = await parent();
	const entry = pieces.find((p) => p.slug === params.slug);
	if (!entry) error(404, `There is no piece called “${params.slug}”.`);
	const res = await fetch(mediaUrl(season, `${entry.slug}/piece.json`));
	if (!res.ok) error(res.status, `Could not load the data for “${entry.label}”.`);
	return { entry, piece: (await res.json()) as PieceData };
};

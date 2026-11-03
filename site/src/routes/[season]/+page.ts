import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
	const { season, pieces } = await parent();
	redirect(307, resolve('/[season]/[slug]', { season, slug: pieces[0].slug }));
};

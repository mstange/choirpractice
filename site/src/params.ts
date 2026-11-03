import { defineParams } from '@sveltejs/kit/params';

export const params = defineParams({
	/** The Lyrics view; the Pitch view has no segment. */
	view: (param) => (param === 'lyrics' ? param : undefined)
});

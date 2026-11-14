import { svelte } from '@sveltejs/vite-plugin-svelte';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sirv from 'sirv';
import { defineConfig, type Connect, type Plugin } from 'vite';

/**
 * The choir app's media/ directory, with its seasons of pieces and its soundfont/ directory of MS
 * Basic programs: next to this repository, unless MEDIA says where.
 */
const MEDIA = resolve(process.env.MEDIA ?? '../media');

/**
 * Serves MEDIA at media/, and at media/seasons.json the list of its seasons: the directories that
 * have a pieces.json, with its contents.
 */
function media(): Plugin {
	const serve = sirv(MEDIA, { dev: true });
	const use = ({ middlewares }: { middlewares: Connect.Server }) => {
		middlewares.use('/media', (req, res, next) => {
			if (req.url !== '/seasons.json') return serve(req, res, next);
			const seasons = readdirSync(MEDIA, { withFileTypes: true })
				.filter((d) => d.isDirectory() && existsSync(`${MEDIA}/${d.name}/pieces.json`))
				.map((d) => ({
					id: d.name,
					...JSON.parse(readFileSync(`${MEDIA}/${d.name}/pieces.json`, 'utf8'))
				}));
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify(seasons));
		});
	};
	return { name: 'media', configureServer: use, configurePreviewServer: use };
}

export default defineConfig({
	plugins: [media(), svelte()],
	worker: { format: 'es' },
	// The synthesizer is the choir app's, in ../site, and should use the same spessasynth as the rest.
	resolve: { dedupe: ['spessasynth_core'] },
	server: { fs: { allow: ['..'] } }
});

import { svelte } from '@sveltejs/vite-plugin-svelte';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sirv from 'sirv';
import { defineConfig, type Connect, type Plugin } from 'vite';

/**
 * The choir app's media/ directory, with its seasons of pieces and its soundfont/ directory of MS
 * Basic programs: next to this repository, unless MEDIA says where.
 */
const MEDIA = resolve(process.env.MEDIA ?? '../media');

/**
 * Serves MEDIA at media/, and at media/seasons.json the names of its seasons: the directories that
 * have a pieces.json.
 */
function media(): Plugin {
	const serve = sirv(MEDIA, { dev: true });
	const use = ({ middlewares }: { middlewares: Connect.Server }) => {
		middlewares.use('/media', (req, res, next) => {
			if (req.url !== '/seasons.json') return serve(req, res, next);
			const seasons = readdirSync(MEDIA, { withFileTypes: true })
				.filter((d) => d.isDirectory() && existsSync(`${MEDIA}/${d.name}/pieces.json`))
				.map((d) => d.name);
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify(seasons));
		});
	};
	return { name: 'media', configureServer: use, configurePreviewServer: use };
}

export default defineConfig({
	// So that it works wherever it is served, such as at choirpractice.app/soundfont-designer/.
	base: './',
	plugins: [media(), svelte()],
	worker: { format: 'es' },
	// The synthesizer is the choir app's, in ../site, and should use the same spessasynth as the rest.
	resolve: { dedupe: ['spessasynth_core'] },
	// A port of its own: on the choir app's (Vite's default), the browser would keep the choir app's
	// service worker, which in development imports ../site/src/service-worker/index.ts from here.
	server: { port: 5288, strictPort: true, fs: { allow: ['..'] } }
});

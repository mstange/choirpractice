import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import sirv from 'sirv';
import { defineConfig, type Plugin } from 'vite';

/**
 * Serves the repository's media/ directory, the piece data written by tools/build.sh, at media/
 * in `vite dev` and `vite preview`. It isn't part of the build: deployed pages fetch it from
 * VITE_MEDIA_BASE instead (see src/lib/pieces.ts).
 */
function media(): Plugin {
	const serve = sirv('../media', { dev: true });
	const use = ({
		middlewares
	}: {
		middlewares: { use: (path: string, f: typeof serve) => void };
	}) => {
		middlewares.use('/media', serve);
	};
	return { name: 'media', configureServer: use, configurePreviewServer: use };
}

export default defineConfig({
	// For profiles and stack traces of the deployed page.
	build: { sourcemap: true },
	plugins: [
		media(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Hash routing (index.html#/<season>/<slug>) keeps the output a single static page that any
			// static file server can host, including `python3 -m http.server`.
			router: { type: 'hash' },
			adapter: adapter()
		})
	]
});

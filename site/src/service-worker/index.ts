// Lets the installed app open offline: the page's own files come from a cache per version, and the
// media from the network, or from the media cache when the network fails.
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { self } from '$app/service-worker';
import { MEDIA_BASE, MEDIA_CACHE } from '#lib/media.ts';

const APP_CACHE = `app-${version}`;
const scope = self.registration.scope;
const appFiles = ['', ...immutable, ...assets].map(
	(f) => new URL(typeof f === 'string' ? f : f.path, scope).href
);
const media = new URL(MEDIA_BASE + '/', scope).href;

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(appFiles)));
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys())
				if (key.startsWith('app-') && key !== APP_CACHE) await caches.delete(key);
			// So that the media of the first visit is cached too.
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	if (request.url.startsWith(media)) event.respondWith(fromMedia(event));
	else if (request.mode === 'navigate') event.respondWith(page(request));
	else if (appFiles.includes(request.url)) event.respondWith(fromApp(request));
});

/** One of the page's built or static files, which are cached with their version. */
async function fromApp(request: Request) {
	// Module scripts are requested with an Origin header, which a Vary: Origin would make not match.
	const cached = await caches.match(request.url, { cacheName: APP_CACHE, ignoreVary: true });
	return cached ?? fetch(request);
}

/** The page itself (index.html, whatever the hash): fresh if online, else this version's. */
async function page(request: Request) {
	try {
		return await fetch(request);
	} catch (e) {
		const cached = await caches.match(scope, { cacheName: APP_CACHE, ignoreVary: true });
		if (cached) return cached;
		throw e;
	}
}

/**
 * A media file from the network, which updates the media cache, or from the cache if the network
 * fails. A file that is gone (a retired season key) leaves the cache. Every media request is made
 * with CORS, so that sheet music images don't end up as opaque responses.
 */
async function fromMedia(event: FetchEvent) {
	const url = event.request.url;
	const cache = await caches.open(MEDIA_CACHE);
	let res: Response;
	try {
		res = await fetch(url, { mode: 'cors', credentials: 'omit' });
	} catch (e) {
		// The media host sends Vary: Origin, and the request that saved a file may have had none.
		const cached = await cache.match(url, { ignoreVary: true });
		if (cached) return cached;
		throw e;
	}
	if (res.ok) event.waitUntil(cache.put(url, res.clone()));
	else if (res.status === 404 || res.status === 403) event.waitUntil(cache.delete(url));
	return res;
}

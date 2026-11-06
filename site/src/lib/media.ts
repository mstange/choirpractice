// Shared by the page and the service worker.

/** Where the seasons' directories are: the media/ directory next to the page, unless configured. */
export const MEDIA_BASE = import.meta.env.VITE_MEDIA_BASE ?? 'media';

/** The Cache Storage cache of media files, which the service worker falls back on offline. */
export const MEDIA_CACHE = 'media';

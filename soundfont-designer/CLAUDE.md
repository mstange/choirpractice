@README.md

## Browser testing

`.dev/` (not checked in) has Playwright scripts that import Playwright from the choir app's `../.dev/node_modules`. Launch Firefox with `firefoxUserPrefs: { "media.volume_scale": "0.0" }` so that playback stays silent, and run them against `npm run dev` (port 5288).

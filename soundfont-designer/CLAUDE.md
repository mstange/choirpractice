@README.md

## Version control

This is a jj repo. After finishing each logical unit of work, run `jj commit -m "..."` without being asked; one commit per logical unit.

## Browser testing

`.dev/` (not checked in) has Playwright scripts that import Playwright from `../choirpractice-app/.dev/node_modules`. Launch Firefox with `firefoxUserPrefs: { "media.volume_scale": "0.0" }` so that playback stays silent, and run them against `npm run dev -- --port 5288`.

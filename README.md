# Choir lyrics/pitch player

A static web page that plays a MuseScore score as music plus a visual display:

- **Pitch:** SingStar-style note bars on a shared pitch axis, with the sheet music in a strip below them.
- **Lyrics:** karaoke-style lyric lines.

The user picks one or more dominant parts (shift-click adds or removes a part). Those parts are drawn prominently and are louder in the mix. The page plays the score's MIDI file with soundfont instruments in the browser, so the music can play slower or faster at the same pitch, and the vocal parts can play on another instrument, such as a pan flute.

The pieces come in **seasons**: a season is a directory with a `pieces.json` and one directory per piece, and the page opens one with `index.html#/<season>/<slug>`. The scores are licensed, so their data isn't part of this repository and the deployed page fetches it from a separate host, where each season's directory is named by a secret key (see Deploying).

## Layout

- `media/<season>/`: the data of a season's pieces. It is not checked in (see `.gitignore`), except for `media/demo/`.
  - `pieces.json` lists the pieces offered in the piece menu.
  - `<slug>/` holds the data of one piece, written by `tools/build.sh`.
  - `media/demo/` is a season of public-domain pieces, so that the page works without a licensed score: Frère Jacques as a round in four parts, and Mozart's Ave verum corpus for SATB choir and piano. Their scores are `media/demo/<slug>.mscz`; rebuild one with `tools/build.sh media/demo/<slug>.mscz demo/<slug>`. The page links to them as `#/demo` and `#/demo/ave-verum-corpus`.
- `media/soundfont/`: one soundfont file per General MIDI program, `<program>.sf3`, for every program that a piece plays or that the instrument menu offers, cut from MuseScore's MS Basic soundfont, with its license. It is checked in, and is shared by all seasons.
- `tools/build.sh <score.mscz> <season>/<slug>`: the whole pipeline for one score. It writes `media/<season>/<slug>/piece.json`, `media/<season>/<slug>/score.mid`, MuseScore's MIDI export, which the page plays, and `media/<season>/<slug>/engraving/<name>.svg`, the sheet music. Then it runs `site/scripts/soundfont.ts`.
- `tools/extract.py`: reads MuseScore's MusicXML and MIDI exports and writes `piece.json`, which holds:
  - title, subtitle, credits, from the score's title frame (the MusicXML export leaves it out), or else from its metadata in File › Properties;
  - measure start times;
  - the parts with their MIDI channels;
  - for each vocal part, its syllables and notes.
- `tools/engrave.py`: has MuseScore engrave each vocal part, and all vocal parts together, as one long line of sheet music, and adds the time and x position of every chord and rest to `piece.json`.
- `site/scripts/soundfont.ts`: writes `media/soundfont/` from MS Basic, for the programs of every `score.mid` in `media/` and of the instrument menu (`src/lib/instruments.ts`). Run it with `node site/scripts/soundfont.ts`.
- `site/`: the page, a SvelteKit app (Svelte 5) built into a single static page with hash routing. Run `npm install` in `site/` once.
  - `src/lib/Player.svelte`: the player UI: controls, part selection, keyboard shortcuts.
  - `src/lib/Lyrics.svelte`: the Lyrics view. `src/lib/canvas.ts` draws the Pitch view and the timeline, and `src/lib/sheet.ts` the sheet music strip of the Pitch view.
  - `src/lib/synth.svelte.ts`: playing the music. It runs `src/lib/synth-worker.ts` in a worker, which reads the MIDI file and decodes soundfont samples, and `src/lib/synth-worklet.ts` in the audio thread, which plays the score with the `Engine` of `src/lib/synth-engine.ts`. `src/lib/instruments.ts` lists the instruments that the vocal parts can play with.
  - `src/lib/mic.svelte.ts` and `src/lib/pitch.ts`: the microphone and its pitch detection.
  - `src/lib/session.svelte.ts`: what carries over when another piece is picked: the mic, the mix emphasis and Extra Piano, and the selected parts, which are mapped to the new piece's parts by name, then by name without its number, then by voice type. Once the user changes a piece's selected parts or Mix settings, the piece keeps them in `localStorage` and gets them back on later visits instead of what carries over; its speed is kept the same way, but doesn't carry over. The mic delay and the vocal instrument are kept for all pieces.
  - `src/lib/pieces.ts`: where the season directories are. `vite.config.ts` serves `media/` next to the page for `npm run dev` and `npm run preview`; a deployed page fetches from `VITE_MEDIA_BASE`.
  - Select a piece with `index.html#/<season>/<slug>`, or `index.html#/<season>/<slug>/lyrics` for its Lyrics view. `index.html#/<season>` opens the season's first piece. The view carries over when another piece is picked from the menu. The `lyrics` segment is matched in `src/params.ts`.
- Formatting: `npm run format` in `site/` formats the page with Prettier, and `uvx ruff format tools` the Python tools.

## Adding a piece

1. **Build.** Copy the downloaded `.mscz` somewhere neutral first if you like; the script only reads it. Run:
   ```sh
   tools/build.sh "/path/to/Score.mscz" my-season/my-slug
   ```
   It fails if the score's staves don't map onto the MIDI file's tracks, or if a part plays percussion. It prints syllable and note counts per vocal part. "unsung notes" should be 0. If it isn't, notes without lyrics are following a rest, which usually means a lyric is missing in the score. "lyrics on tied notes" counts lyrics placed on the continuation of a tie, which the score probably meant as a slur. Each of them starts a new bar. Below each part's counts it lists suspicious spots by bar number, for checking in MuseScore:
   - a lyric on the continuation of a tie;
   - a lyric inside a solid slur that started on an earlier note (dashed and dotted slurs, which often mean "don't breathe", are ignored);
   - a note without a lyric after a rest;
   - syllable tags that don't chain, such as a word that begins but never ends, which often means a lyric is missing;
   - a lyric on a verse line other than 1.
2. **Register the piece.** Add an entry to `media/<season>/pieces.json`, a JSON array:
   ```json
   { "slug": "my-slug", "label": "Menu label", "hues": [["", 215], ["Word", 30]] }
   ```
   `hues` is optional. Each `[word, hue]` changes the background hue at the first syllable of the first vocal part that starts with `word`; an empty word matches from the beginning.
   `levels` is optional too: `{ "Violoncello": 0.2 }` starts that accompaniment part's volume slider at 0.2 instead of 0.6.
3. **Serve and look.** Either run the dev server, which reloads on changes:
   ```sh
   cd site && npm run dev
   ```
   Or build the static page into `site/build/` and serve that with `media/`:
   ```sh
   cd site && npm run build && npm run preview
   ```
   Open `#/<season>/<slug>`.
   `npm run check` type-checks the app.
4. **Verify.** See the next section.
5. **Check in** any new files in `media/soundfont/`, the instruments of the new piece.

## Verifying a build

- **Text and parts:** check the title, subtitle and credits, which vocal parts were detected, and each part's reconstructed lyric text.
  - Any part whose first staff has lyrics counts as vocal.
  - Parts without lyrics become accompaniment and get their own volume slider.
- **Timing:** the notes on the page and the music both come from the same MIDI file, so they line up unless the score has repeats; see Limitations.
- **In the browser:** look at all three views. **Do not play audio audibly without asking**, because the user may be listening to something else. To test playback, launch the browser with the `media.volume_scale` pref set to `"0.0"`. Autoplay rules require a real click on Play (a scripted `.click()` leaves the AudioContext suspended).
  - When serving `site/build/` with `npm run preview`, rebuild after editing and reload with `location.reload(true)`; the built JS has hashed names, but `index.html` itself may be cached.

## Deploying

The page and the media are hosted separately on Cloudflare: the page as a Worker with static assets at `choirpractice.app`, and the media in an R2 bucket at `media.choirpractice.app`, which charges nothing for downloads. Both domains need the zone to be on Cloudflare.

- **Media host:** an R2 bucket with public access through a custom domain such as `media.choirpractice.app`, with
  - a CORS rule that allows `GET` from the page's origin;
  - no directory listing, which is R2's default.
- **Season keys:** a season is uploaded under a random key instead of its name, for example from `openssl rand -hex 16 > media/<season>.key`. Keeping it in `media/` keeps it out of the repository. Whoever has the link `https://choirpractice.app/#/<key>/` can open the season, so it is meant for people who bought the sheet music. A new season gets a new key. The key is in the URL fragment, which browsers don't send to the page's host.
- **Demo:** `media/demo` is uploaded under the name `demo`, without a key.
- **Soundfont:** `media/soundfont` is uploaded under the name `soundfont`, for all seasons.
- **Upload** a season with [rclone](https://rclone.org/) configured for R2. Uploads replace files under the same names, so every file is revalidated on each request:
  ```sh
  rclone sync media/<season> r2:choirpractice-media/$(cat media/<season>.key) --header-upload "Cache-Control: no-cache"
  rclone sync media/demo r2:choirpractice-media/demo --exclude '*.mscz' --header-upload "Cache-Control: no-cache"
  rclone sync media/soundfont r2:choirpractice-media/soundfont --header-upload "Cache-Control: no-cache"
  ```
- **Page:** `cd site && npm run deploy` builds the page with `VITE_MEDIA_BASE` set to the media host and uploads `site/build/` with `wrangler deploy`, as configured in `site/wrangler.jsonc`. The live page is whatever is in the working copy. Any other static host works too: build with `VITE_MEDIA_BASE=https://<media host> npm run build` and upload `site/build/`.

## How it works and why

- **Timing:** the time of each note comes from MuseScore's own MIDI export (its tempo events), which is also what the page plays, so fermatas, ritardandos and tempo marks match the music exactly. MusicXML positions in quarter notes are mapped to MIDI ticks 1:1.
- **Syllables:** a syllable lasts from its note until the next rest or the next note that has a lyric. Notes without a lyric extend the previous syllable (melismas). Tied notes become one bar, unless a later note of the tie has a lyric. Word boundaries in the page are decided from the *previous* syllable's syllabic tag, which tolerates a word's last syllable being wrongly entered as "single".
- **Music:** the page plays `score.mid` with [spessasynth_core](https://github.com/spessasus/spessasynth_core), a SoundFont synthesizer in TypeScript, and MuseScore's MS Basic soundfont, which is what MuseScore itself plays when no Muse Sounds are installed.
  - **Parts:** MuseScore writes one MIDI track per staff, in score order, so `extract.py` maps the parts onto the tracks by their staff counts and checks the result against the channel that the MusicXML names for each part. A part plays on all channels of its tracks: an instrument can have several, such as a cello's arco, pizzicato and tremolo. The emphasis and the volume sliders set the gain of a part's channels; the audio thread moves a gain to its new value over about 50 ms, since the synthesizer applies a gain change at once.
  - **Extra Piano:** with the Mix panel's Extra Piano checkbox on (the default), a piano also plays the selected parts, at their gain, since a piano's attack makes the start of each note easier to hear than a choir sound does. Each vocal part has its piano on a channel of its own beyond the MIDI file's 16 (skipping 25, which spessasynth makes a drum channel), with a copy of the part's notes; the checkbox and the selection only set these channels' gains. So the piano's samples for the vocal parts' notes are fetched and decoded for every piece, and the silent piano channels are still rendered.
  - **Instruments:** the Mix panel's Vocal Instrument menu offers the instruments of `src/lib/instruments.ts`, Choir Aahs by default, and plays all vocal parts with the one picked, whatever program the score gives them. Vocal parts with several channels keep theirs.
  - **Soundfont files:** MS Basic is a 51 MB file, so `soundfont.ts` splits it into one file per program, keeping the samples' Ogg Vorbis compression. Choir Aahs is about 0.65 MB, a woodwind about 0.1 MB, the grand piano 9 MB. The page fetches the files of the programs that the piece plays, and the file of an instrument once it is picked.
  - **Decoding:** the samples are Ogg Vorbis, and the synthesizer would decode each the first time a note needs it, in the audio thread, where the decoding would stall playback. Instead the worker decodes, for each channel, the samples that its notes need (each key and velocity it plays) before the channel switches to an instrument, and hands them to the audio thread, so nothing is decoded while playing. Until the piece's instruments have loaded, Play waits.
  - **Scheduling:** the `Engine` in the audio thread renders the synthesizer in pieces between events, so that each MIDI event happens on the first sample frame at which the score reaches its time. The page tells it at which frame of the audio context to start playing, from where and at what rate, so the page knows the score position of every frame without being told. Program changes in the MIDI file are ignored; the page sets each channel's program.
  - **Speed:** the Speed slider (50% to 150%) changes the rate at which the score's time passes. The pitch doesn't change, and since the time stays score time, the views don't need to know.
  - **Seeking:** a seek releases the notes that sound, replays the controller events before the new position, and starts the notes that sound there part-way through: their envelopes, LFOs and sample position are moved on as if the note had played since its start. So a held note goes on sounding, rather than staying silent until the next note. A note that starts exactly at the new position starts normally.
  - **Pausing and holding** release the notes, so they fade out the way the soundfont ends a note.
- **Loop:** the ruler above the Pitch view holds a loop of whole measures, drawn yellow while looping is on and grey while it is off. Dragging along the ruler makes a loop over the measures it covers, dragging the loop's ends or middle resizes or moves it, and tapping it (or L) turns looping on or off. Tapping elsewhere on the ruler seeks to that measure. Playback that reaches the loop's end from before it goes on at its start; Play outside the loop starts at its start, but seeking past it while playing plays on.
  - The audio thread repeats the loop without a gap: at the loop's end it seeks to its start, as a seek does, on the same sample frame. The notes that sound at the end fade out as if released. Changing the loop while playing restarts playback at the playhead, with a short gap.
- **Zoom:** ctrl+wheel and two-finger pinches change how many seconds the Pitch view shows (2 to 40, 10 at first, kept in `localStorage`). The "now" line stays in place, since moving it would move the playhead. A trackpad pinch arrives as ctrl+wheel with small pixel deltas, the OS's magnification scaled by about 100, so a pixel delta zooms by exp(-deltaY / 100), which matches the browser's own pinch-zoom; a single event zooms by at most 1.25, which covers mouse wheel notches (about 100 px each) and coalesced events. While a touch pinch lasts, until all fingers are up, the fingers don't pan, seek or edit the loop.
- **Dragging:** the Pitch view pans when dragged, and the sheet music and the timeline seek to the pointer. While the pointer is down, playback holds: it stays playing but silent, like while the instruments load, and resumes on release.
- **Sheet music:** with one part selected, the Pitch view's sheet music strip shows that part's engraving; with several, the one with all vocal parts. Pieces with more than four vocal parts have no such engraving, since its staves would be too small to read, and show no sheet music while several parts are selected.
  - `engrave.py` writes a copy of the score per engraving, with the other parts hidden (`<show>0</show>` on the `<Part>`), title frames and layout breaks removed, a 2000-inch page, no header or footer (the copyright line would sit at the far end of the page), and the lyrics' minimum distance at 1 sp (MuseScore's default of 0.25 lets syllables run together). MuseScore doesn't stretch a mostly empty last system, so the line keeps its natural spacing.
  - Positions come from MuseScore's segment position export (`mscore -o x.spos`): per chord or rest of the whole score, its time in milliseconds and its x position in 1/12 SVG units (the left edge of the noteheads). The times come from the export of the unchanged score, which has the same timing as the MIDI file: hiding parts can change how MuseScore stretches the time at a fermata that the staves don't all have on the same beat. Segments in which only hidden parts have notes get meaningless positions, so only those at an onset of a shown part, according to the MusicXML, are kept. The trimmed SVG (`-T 0`) is shifted against page coordinates; an untrimmed export gives the shift.
  - Engraved notes aren't spaced in proportion to time, so a continuously scrolling sheet would keep changing speed. Instead the sheet stands still while a cursor moves along it, its position interpolated between the segments. When the cursor passes 80% of the strip, the sheet slides on by 60% of the strip, so some of the music before and after stays visible. It stands still while the cursor is dragged, so that dragging to the edge doesn't run ahead.
  - The strip is sized so that staff lines are 7 px apart (`engrave.py` records each engraving's staff line distance), but takes at most a third of the window.
  - The page draws the SVG in white tiles of 1024 device pixels at the current scale and keeps only the tiles in view.
- **Microphone:** the mic button (or M) draws the pitch you sing in the Pitch view: a white marker on the "now" line, and a trail behind it while playing. Seeking back and singing again replaces the trail from there on.
  - **Delay:** the trail is drawn earlier than recorded by half the analysis window plus the Mix panel's Mic delay (120 ms by default, which suits a MacBook's built-in mic). Browsers don't report the mic's input latency (Firefox has neither `getSupportedConstraints().latency` nor a `latency` track setting), and it depends on the hardware, so the user sets it by lining up the trail with the bars after singing; moving the slider shifts the trail already sung. It is kept in `localStorage`. The delays are in seconds, so at other speeds they are scaled to the score's time. The playback position accounts for the context's `baseLatency` plus `outputLatency`.
  - The pitch comes from the McLeod pitch method (`pitch.ts`), run on the latest 2048 mic samples once per animation frame (about 1.3 ms at 48 kHz). The resonator bank from [jhartquist/resonators](https://github.com/jhartquist/resonators) was considered, but it only yields a spectrum; picking a fundamental from that is prone to octave errors.
  - Frames count as unpitched below an NSDF clarity of 0.8 or below about -50 dBFS. On MuseScore's soundfont choir sound, about 96% of the pitched frames are within a quarter tone of the score; with a real voice the thresholds are untested.
  - Noise suppression is off (it treats sustained tones as noise) and echo cancellation is on, but headphones are still the reliable way to keep the playback out of the mic.
- **Memory:** the audio thread keeps the samples that the score's notes use decoded, as 32-bit floats. For the pieces in `media/` that is 1 to 10 MB for the voices, plus 40 to 100 MB for a piano part, whose samples are long and come in several velocity layers (computed from the files; the browser's total memory use wasn't measured).

## Limitations

- **Dynamics differ from MuseScore's playback in places.** The MIDI export has the dynamics as note velocities, and in some passages, such as hairpins, these differ from MuseScore's own playback by several dB (seen in Ave verum corpus: up to about 12 dB quieter through a crescendo). From p to f the soundfont also gets less louder than in MuseScore's playback, about 9.5 dB instead of 13.
- **No percussion.** Drum kits play on MIDI channel 10, which `soundfont.ts` doesn't write files for; it stops on a piece that uses it.
- **No repeats.** The timing code assumes score position maps 1:1 to MIDI ticks. A score with repeats or jumps needs the MusicXML and MIDI handled with repeats unrolled (`mscore --unroll-repeats`, untested), or the timing will be wrong after the first repeat.
- **MuseScore 4 files only.** `engrave.py` sets the engraving style in `score_style.mss`, which MuseScore 3 files don't have (they keep their style in the `.mscx`), so `build.sh` stops on them. Open such a score in MuseScore 4 and save it first.
- **One voice, one verse.** Only voice 1 of each part's first staff is read. Divisi written as a second voice on the same staff is ignored. Only one verse is shown: the lowest-numbered lyric on each note.
- **Colors and keys.** Colors are chosen by part name (soprano, alto, tenor, bass, then a second shade for "Alto 2" and similar). Other names get fallback colors. Keyboard part selection covers up to 9 parts.
- **Overlapping text.** In the Pitch view with several parts selected, lyrics of different parts can overlap; the Lyrics view is clearer for that.

## Local environment notes (this machine)

- **MuseScore CLI:** `/Applications/MuseScore 4.app/Contents/MacOS/mscore`, version 4.7. Its soundfont, which `soundfont.ts` reads, is `/Applications/MuseScore 4.app/Contents/Resources/sound/MS Basic.sf3`.
- **Browser testing:** use Playwright from `.dev/` (not checked in): run `npm install` there once, write a script as `.dev/<name>.mjs`, and run it with `node .dev/<name>.mjs` against the dev server. Its own Firefox, Chromium and WebKit builds are installed. Launch Firefox with `firefoxUserPrefs: { 'media.volume_scale': '0.0' }` to keep playback silent, and use Chromium with `devices['iPhone 13']` for the mobile layout (Firefox doesn't emulate touch, and the installed WebKit doesn't match the Playwright version); `.dev/mobile.mjs` takes such a screenshot. The existing scripts there are examples. Firefox's own `--screenshot` hangs on this page.

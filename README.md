# Choir lyrics/pitch player

A static web page that plays a MuseScore score as synchronized audio plus a visual display:

- **Pitch:** SingStar-style note bars on a shared pitch axis, with the sheet music in a strip below them.
- **Lyrics:** karaoke-style lyric lines.

The user picks one or more dominant parts (shift-click adds or removes a part). Those parts are drawn prominently and are louder in the mix: every part is a separate audio stem, mixed live with Web Audio.

The pieces come in **seasons**: a season is a directory with a `pieces.json` and one directory per piece, and the page opens one with `index.html#/<season>/<slug>`. The scores are licensed, so their data isn't part of this repository and the deployed page fetches it from a separate host, where each season's directory is named by a secret key (see Deploying).

## Layout

- `media/<season>/`: the data of a season's pieces. It is not checked in (see `.gitignore`), except for `media/demo/`.
  - `pieces.json` lists the pieces offered in the piece menu.
  - `<slug>/` holds the data of one piece, written by `tools/build.sh`.
  - `media/demo/` is a season with one piece, Frère Jacques as a round in four parts, so that the page works without a licensed score. Its score is `media/demo/frere-jacques.mscz`; rebuild it with `tools/build.sh media/demo/frere-jacques.mscz demo/frere-jacques`. The page links to it as `#/demo`.
- `tools/build.sh <score.mscz> <season>/<slug>`: the whole pipeline for one score. It writes `media/<season>/<slug>/piece.json`, `media/<season>/<slug>/audio/<part>/<k>.mp3`, the chunks of each part's stem, and `media/<season>/<slug>/engraving/<name>.svg`, the sheet music.
- `tools/extract.py`: reads MuseScore's MusicXML and MIDI exports and writes `piece.json`, which holds:
  - title, subtitle, credits, from the score's title frame (the MusicXML export leaves it out), or else from its metadata in File › Properties;
  - measure start times;
  - the parts with their stem directories;
  - for each vocal part, its syllables and notes.
- `tools/make_stems.py`: writes one copy of the score per part with all other parts muted, plus an all-muted "baseline" copy.
- `tools/engrave.py`: has MuseScore engrave each vocal part, and all vocal parts together, as one long line of sheet music, and adds the time and x position of every chord and rest to `piece.json`.
- `tools/encode_stems.py`: encodes each rendered stem as 10-second mp3 chunks and adds their layout to `piece.json`.
- `tools/check_entries.py`: checks that the audio lines up with the score (see Verifying).
- `site/`: the page, a SvelteKit app (Svelte 5) built into a single static page with hash routing. Run `npm install` in `site/` once.
  - `src/lib/Player.svelte`: the player UI: controls, part selection, keyboard shortcuts.
  - `src/lib/Lyrics.svelte`: the Lyrics view. `src/lib/canvas.ts` draws the Pitch view and the timeline, and `src/lib/sheet.ts` the sheet music strip of the Pitch view.
  - `src/lib/audio.svelte.ts`: loading the stem chunks and mixing them with Web Audio.
  - `src/lib/mic.svelte.ts` and `src/lib/pitch.ts`: the microphone and its pitch detection.
  - `src/lib/session.svelte.ts`: what carries over when another piece is picked: the mic, the view, the mix emphasis, and the selected parts, which are mapped to the new piece's parts by name, then by name without its number, then by voice type.
  - `src/lib/pieces.ts`: where the season directories are. `vite.config.ts` serves `media/` next to the page for `npm run dev` and `npm run preview`; a deployed page fetches from `VITE_MEDIA_BASE`.
  - Select a piece with `index.html#/<season>/<slug>`. `index.html#/<season>` opens the season's first piece.
- Formatting: `npm run format` in `site/` formats the page with Prettier, and `uvx ruff format tools` the Python tools.

## Adding a piece

1. **Turn off MuseScore's metronome.** It is a user preference, and the CLI renders it into every stem. `build.sh` refuses to run while it is on. Remember the current value, switch it off, and restore it after building:
   ```sh
   defaults read org.musescore.MuseScore4 application.playback.metronomeEnabled
   defaults write org.musescore.MuseScore4 application.playback.metronomeEnabled -int 0
   # ... build ...
   defaults write org.musescore.MuseScore4 application.playback.metronomeEnabled -int 1   # if it was 1
   ```
2. **Build.** Copy the downloaded `.mscz` somewhere neutral first if you like; the script only reads it. Run:
   ```sh
   tools/build.sh "/path/to/Score.mscz" my-season/my-slug
   ```
   It fails if a stem comes out silent, which means its part couldn't be isolated. It prints syllable and note counts per vocal part. "unsung notes" should be 0. If it isn't, notes without lyrics are following a rest, which usually means a lyric is missing in the score. "lyrics on tied notes" counts lyrics placed on the continuation of a tie, which the score probably meant as a slur. Each of them starts a new bar. Below each part's counts it lists suspicious spots by bar number, for checking in MuseScore:
   - a lyric on the continuation of a tie;
   - a lyric inside a slur that started on an earlier note;
   - a note without a lyric after a rest;
   - syllable tags that don't chain, such as a word that begins but never ends, which often means a lyric is missing;
   - a lyric on a verse line other than 1.
3. **Register the piece.** Add an entry to `media/<season>/pieces.json`, a JSON array:
   ```json
   { "slug": "my-slug", "label": "Menu label", "hues": [["", 215], ["Word", 30]] }
   ```
   `hues` is optional. Each `[word, hue]` changes the background hue at the first syllable of the first vocal part that starts with `word`; an empty word matches from the beginning.
4. **Serve and look.** Either run the dev server, which reloads on changes:
   ```sh
   cd site && npm run dev
   ```
   Or build the static page into `site/build/` and serve that with `media/`:
   ```sh
   cd site && npm run build && npm run preview
   ```
   Open `#/<season>/<slug>`.
   `npm run check` type-checks the app.
5. **Verify.** See the next section.

## Verifying a build

- **Text and parts:** check the title, subtitle and credits, which vocal parts were detected, and each part's reconstructed lyric text.
  - Any part whose first staff has lyrics counts as vocal.
  - Parts without lyrics become accompaniment and get their own volume slider.
- **Timing:** run `python3 -I tools/check_entries.py media/<season>/<slug>`.
  - Expect values of roughly 0.02–0.05 s, the attack of the voice sound.
  - Larger or drifting values mean the timing doesn't match the audio. Repeats are the usual cause; see Limitations.
  - Entries inside a final ritardando are only covered if a part comes in after a rest there.
- **Stem isolation:** a vocal stem should be digitally silent (about -91 dB) during that part's own rests, even while other parts sing. Check a chunk with `ffmpeg -i audio/<part>/<k>.mp3 -af atrim=START:END,volumedetect -f null -`; chunk `k` starts at `10k - 0.1` seconds (at 0 for chunk 0).
- **Stem sum:** the stems summed together do **not** exactly equal MuseScore's full mix in choir passages (the difference is about 9 dB below the music; the cause is unknown). Instrument-only passages match almost perfectly (about -65 dB). This doesn't matter for the page.
- **In the browser:** look at all three views. **Do not play audio audibly without asking**, because the user may be listening to something else. To test playback, launch the browser with the `media.volume_scale` pref set to `"0.0"`. Autoplay rules require a real click on Play (a scripted `.click()` leaves the AudioContext suspended).
  - When serving `site/build/` with `npm run preview`, rebuild after editing and reload with `location.reload(true)`; the built JS has hashed names, but `index.html` itself may be cached.

## Deploying

The page and the media are hosted separately on Cloudflare: the page as a Worker with static assets at `choirpractice.app`, and the media in an R2 bucket at `media.choirpractice.app`, which charges nothing for downloads. Both domains need the zone to be on Cloudflare.

- **Media host:** an R2 bucket with public access through a custom domain such as `media.choirpractice.app`, with
  - a CORS rule that allows `GET` from the page's origin;
  - no directory listing, which is R2's default.
- **Season keys:** a season is uploaded under a random key instead of its name, for example from `openssl rand -hex 16 > media/<season>.key`. Keeping it in `media/` keeps it out of the repository. Whoever has the link `https://choirpractice.app/#/<key>/` can open the season, so it is meant for people who bought the sheet music. A new season gets a new key. The key is in the URL fragment, which browsers don't send to the page's host.
- **Demo:** `media/demo` is uploaded under the name `demo`, without a key.
- **Upload** a season with [rclone](https://rclone.org/) configured for R2. Uploads replace files under the same names, so every file is revalidated on each request:
  ```sh
  rclone sync media/<season> r2:choirpractice-media/$(cat media/<season>.key) --header-upload "Cache-Control: no-cache"
  rclone sync media/demo r2:choirpractice-media/demo --exclude '*.mscz' --header-upload "Cache-Control: no-cache"
  ```
- **Page:** `cd site && npm run deploy` builds the page with `VITE_MEDIA_BASE` set to the media host and uploads `site/build/` with `wrangler deploy`, as configured in `site/wrangler.jsonc`. The live page is whatever is in the working copy. Any other static host works too: build with `VITE_MEDIA_BASE=https://<media host> npm run build` and upload `site/build/`.

## How it works and why

- **Timing:** the time of each note comes from MuseScore's own MIDI export (its tempo events), so fermatas, ritardandos and tempo marks match MuseScore's audio export exactly. MusicXML positions in quarter notes are mapped to MIDI ticks 1:1.
- **Syllables:** a syllable lasts from its note until the next rest or the next note that has a lyric. Notes without a lyric extend the previous syllable (melismas). Tied notes become one bar, unless a later note of the tie has a lyric. Word boundaries in the page are decided from the *previous* syllable's syllabic tag, which tolerates a word's last syllable being wrongly entered as "single".
- **Stems:**
  - **MuseScore 4 files** keep mixer mute state in `audiosettings.json` inside the `.mscz`, keyed by part id. A part whose mixer settings were never changed, as in a score imported from MusicXML, has no entry there; `make_stems.py` adds one with just the part and instrument ids, and MuseScore fills in the rest. **MuseScore 3 files** have no such file and use `<mute>1</mute>` on each `<Channel>` in the `.mscx`. Each variant is re-zipped as `.mscz` and exported as WAV. The stems are mixed down to mono: that halves the download and the page's memory, and the page doesn't need the scores' panning.
  - **Baseline subtraction:** MuseScore renders a short sound on the first beat of every export, even with every part muted. The all-muted baseline render captures exactly that, and it is subtracted from each stem before mp3 encoding. Without this, the summed stems pop at the start.
- **Chunks:** each stem is split into 10-second chunks so that playback can start before everything has loaded. The page fetches every chunk, starting at the playhead, and keeps them as mp3. It decodes only the chunk at the playhead and the next three, and waits if playback reaches a chunk that isn't decoded yet. The timeline dims the parts that haven't been fetched yet.
  - Each chunk is encoded with 0.1 s of its neighbours on either side, which the page cuts off after decoding. Without that padding, the noisy mp3 frames at the edges of each encoding make an audible click at every seam.
  - Browsers trim the mp3 encoder delay when decoding, so a decoded chunk has exactly the samples that were encoded. The page checks the decoded length and fails if it doesn't match.
  - The AudioContext runs at the stems' 44.1 kHz, so every chunk starts on a whole sample frame and the browser resamples only the final mix.
- **Sheet music:** with one part selected, the Pitch view's sheet music strip shows that part's engraving; with several, the one with all vocal parts. Pieces with more than four vocal parts have no such engraving, since its staves would be too small to read, and show no sheet music while several parts are selected.
  - `engrave.py` writes a copy of the score per engraving, with the other parts hidden (`<show>0</show>` on the `<Part>`), title frames and layout breaks removed, a 2000-inch page, no header or footer (the copyright line would sit at the far end of the page), and the lyrics' minimum distance at 1 sp (MuseScore's default of 0.25 lets syllables run together). MuseScore doesn't stretch a mostly empty last system, so the line keeps its natural spacing.
  - Positions come from MuseScore's segment position export (`mscore -o x.spos`): per chord or rest of the whole score, its time in milliseconds (the same timing as the audio) and its x position in 1/12 SVG units (the left edge of the noteheads). Segments in which only hidden parts have notes get meaningless positions, so only those at an onset of a shown part, according to the MusicXML, are kept. The trimmed SVG (`-T 0`) is shifted against page coordinates; an untrimmed export gives the shift.
  - Engraved notes aren't spaced in proportion to time, so a continuously scrolling sheet would keep changing speed. Instead the sheet stands still while a cursor moves along it, its position interpolated between the segments. When the cursor passes 80% of the strip, the sheet slides on by 60% of the strip, so some of the music before and after stays visible.
  - The strip is sized so that staff lines are 7 px apart (`engrave.py` records each engraving's staff line distance), but takes at most a third of the window.
  - The page draws the SVG in white tiles of 1024 device pixels at the current scale and keeps only the tiles in view.
- **Microphone:** the mic button (or M) draws the pitch you sing in the Pitch view: a white marker on the "now" line, and a trail behind it while playing. Seeking back and singing again replaces the trail from there on.
  - **Delay:** the trail is drawn earlier than recorded by half the analysis window plus the Mix panel's Mic delay. Browsers don't report the mic's input latency (Firefox has neither `getSupportedConstraints().latency` nor a `latency` track setting), and it depends on the hardware, so the user sets it by lining up the trail with the bars after singing; moving the slider shifts the trail already sung. It is kept in `localStorage`. The playback position accounts for the context's `baseLatency` plus `outputLatency`.
  - The pitch comes from the McLeod pitch method (`pitch.ts`), run on the latest 2048 mic samples once per animation frame (about 1.3 ms at 48 kHz). The resonator bank from [jhartquist/resonators](https://github.com/jhartquist/resonators) was considered, but it only yields a spectrum; picking a fundamental from that is prone to octave errors.
  - Frames count as unpitched below an NSDF clarity of 0.8 or below about -50 dBFS. On MuseScore's soundfont choir stems, about 96% of the pitched frames are within a quarter tone of the score; with a real voice the thresholds are untested.
  - Noise suppression is off (it treats sustained tones as noise) and echo cancellation is on, but headphones are still the reliable way to keep the playback out of the mic.
- **Memory:** decoded audio is 32-bit float at 44.1 kHz, about 176 KB per second of a mono stem, ten times the size of the mp3. Keeping only a window of 40 seconds decoded keeps memory use independent of the piece's length. In Firefox, Exaudi (11 stems, 7 minutes) took about 2 GB as stereo with every chunk decoded. With mono stems and the window it takes about 0.3 GB more than the page without audio, up to 0.5 GB after seeking, which is more than the window itself (about 80 MB) and probably buffers waiting for garbage collection.

## Limitations

- **No repeats.** The timing code assumes score position maps 1:1 to MIDI ticks. A score with repeats or jumps needs the MusicXML and MIDI handled with repeats unrolled (`mscore --unroll-repeats`, untested), or the timing will be wrong after the first repeat.
- **One voice, one verse.** Only voice 1 of each part's first staff is read. Divisi written as a second voice on the same staff is ignored. Only one verse is shown: the lowest-numbered lyric on each note.
- **Colors and keys.** Colors are chosen by part name (soprano, alto, tenor, bass, then a second shade for "Alto 2" and similar). Other names get fallback colors. Keyboard part selection covers up to 9 parts.
- **Overlapping text.** In the Pitch view with several parts selected, lyrics of different parts can overlap; the Lyrics view is clearer for that.

## Local environment notes (this machine)

- **MuseScore CLI:** `/Applications/MuseScore 4.app/Contents/MacOS/mscore`, version 4.7. No Muse Sounds library is installed, so audio uses the basic soundfont.
- **Browser testing:** the firefox-devtools MCP was originally configured with the local build in `~/code/obj-m-opt`, which was broken (its JS and binary didn't match). Use `/Applications/Firefox Nightly.app` with a temporary profile instead.

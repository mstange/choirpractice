# Soundfont Designer

A web page for designing an instrument for [choirpractice-app](../choirpractice-app), synthesized into a SoundFont 2 file, while listening to it in the choir app's pieces.

MS Basic's instruments are a poor fit for following a part: the piano has a clear attack but dies away during long notes, and Choir Aahs sustains but has almost no attack. Neither follows a crescendo during a held note, because MuseScore exports the dynamics, hairpins included, as CC2 (breath controller), which no default SF2 modulator responds to. The velocity only says how loud a note starts.

The designed instrument has two layers on every note:

- **Tone:** a looped spectrum of harmonics, sustained for as long as the note lasts, whose loudness and brightness follow CC2 during the note.
- **Attack:** a short transient of decaying partials and a noise burst, like a plucked or struck string, which marks where each note starts and follows the velocity.

## Running it

```sh
npm install
npm run dev
```

The page plays the pieces of the choir app's `media/` directory, `../choirpractice-app/media` unless `MEDIA` names another (`MEDIA=/path/to/media npm run dev`). It needs the pieces' `piece.json` and `score.mid`, and `media/soundfont/` for the other instruments.

- `npm test` builds the default patch, writes it as SF2, reads it back and renders it with spessasynth, and checks what the file does (see `scripts/test-bank.ts`).
- `node scripts/spectrum.ts [--match] [preset or patch JSON] [keys]` compares the sustain of MS Basic's Choir Aahs with a patch's, as spessasynth renders them: per harmonic its level, the noise beside it and its spread in cents, and how a strong harmonic moves over time. With `--match`, it first matches the patch's contour to Choir Aahs, and measures how near that brought it.
- `npm run check` type-checks, `npm run format` formats with Prettier.

## Using it

- **Listening:** the bar at the top plays a piece with its vocal parts on the designed instrument, or on one of MS Basic's to compare. Focus brings one part forward, as in the choir app, and the loop repeats measures. The timeline shows the vocal parts' notes and, as a white line, the CC2 of the focused part (or the first). Space plays and pauses.
- **Keyboard:** the keyboard at the bottom, or the computer's keys from A (Z and X change the octave), plays the designed instrument, starting with CC2 at the velocity. With Swell, CC2 rises to 127 and back while a key is held. With Latch, keys stay down until pressed again, and sound anew whenever the instrument changes, so that a held chord can be listened to while editing. The last key played is the preview key of the plots.
- **Editing:** every change rebuilds the instrument in a worker, and the next notes play the new version, while playing too. Notes that sound go on with the old one. A rebuild of all samples takes about 200 ms; changing only envelopes, modulators or levels reuses the samples.
- **Spectral contour:** draw it, or let Match fit it to the sustain of one of MS Basic's instruments; it changes the timbre, not the loudness.
- **Note plot:** the level of the preview key over time, as the synthesizer renders the built file: at MuseScore's p, mf and ff velocities, and swelling from p to ff, released at the dashed line.
- **Saving:** the patch being edited is kept in `localStorage`. Save keeps it by name, Export JSON and Import JSON move patches between browsers. Start from offers a few patches to begin with (`src/lib/presets.ts`).
- **Export SF2** writes the file, with its one preset at the program number beside it.

## Putting an exported instrument into the choir app

The choir app fetches `media/soundfont/<program>.sf3` for each General MIDI program; the loader reads the file's content, so an uncompressed SF2 file under that name works.

1. Export with a program that MS Basic's files in `media/soundfont/` don't use, such as 54 (Synth Voice).
2. Copy the file to `media/soundfont/54.sf3` in the choir app.
3. Add `[54, 'Practice Voice']` to `INSTRUMENTS` in `site/src/lib/instruments.ts`. The choir app's `site/scripts/soundfont.ts` would try to write that program from MS Basic, so it needs to skip it.

## How it works

- **Patch:** `src/lib/patch.ts` has the parameters; `src/lib/build.ts` makes the sound bank from them with spessasynth_core's `BasicSoundBank`, one preset of two instruments (tone and attack), with a zone for every few keys (Key spacing) from A1 to C7. Each zone's samples are made for its middle key, so the EQ and formants stay at the same frequencies on every key.
- **Tone samples:** each is a spectrum turned into a signal by an inverse FFT of a power-of-two length (Loop), so the loop repeats seamlessly: every partial, and the breath noise, falls on a bin of the FFT. The fundamental is then off by up to half a bin (0.24 Hz with the defaults), which the sample's pitch correction makes up for, to the nearest cent.
  - The harmonics' levels come from the tilt, the even harmonics' level and the drawn offsets, then the EQ, the formants and the spectral contour. Each key is as loud at full dynamics: the harmonics are normalized to the same power, as the synthesizer's low-pass filter lets them through, so that the timbre controls don't change the loudness. That leaves the Level to set it.
  - **Ensemble:** each harmonic above the fundamental is split into Voices copies, each detuned at random within the Detune. Detuned copies of the fundamental would beat into a throb of the whole note (by ±3.5 dB, about once a second, with three voices); the upper harmonics beat at unrelated rates, which shimmers while the loudness stays within about 2.5 dB (measured over 250 ms).
  - **Stereo width:** above 0, each zone has a left and a right sample, panned apart by the width, each with its own detuned copies and breath noise, so that the two sides beat differently. A partial without copies, like the fundamental, is in both, a quarter period apart. Then the sides add up in power like unrelated signals, at any width, and nothing cancels when they're mixed to mono. Each side is 3 dB softer, since spessasynth pans at constant power. Choir Aahs is two recordings panned hard left and right.
  - **Spectral contour:** dB at third octaves from 50 Hz to 12.7 kHz, in between along the logarithm of the frequency, on the harmonics and the breath noise. **Match** (`src/lib/measure.ts`, in `match-worker.ts`) renders notes of the instrument and of the patch at mf on keys E2 to E5, measures each harmonic's power from 1.5 s on, and fits the change to the contour by least squares over the harmonics that the instrument has above its noise, with an offset of its own for each key (each key's tone is normalized anyway) and a little smoothness between neighbouring points. Since the contour adds in dB before the synthesizer's filter, one fit is about as good as the fit expects: for the default patch against Choir Aahs, 8.5 dB rms per harmonic before, 5.2 as fitted, 5.7 measured again. Fitting each key on its own still leaves about 4 dB: what's left is detail from harmonic to harmonic, and differences between low and high keys, which one contour on fixed frequencies can't follow. The fit is made at mf only: at other dynamics, the tone's filter and the instrument's move differently, by an amount not yet measured.
  - **Formants** are EQ peaks at a tenor's formant frequencies (Csound's table) for the vowel, widened by the Formant width so that they catch a harmonic on low notes too.
- **Attack samples:** decaying sines, each higher harmonic decaying faster (Damping), optionally stretched like a piano string's partials (Inharmonicity), plus white noise through a band-pass with an exponential decay. They play once, without a loop.
- **Levels:** samples are stored at a peak of 0.9, and each zone's `initialAttenuation` brings them to their level (spessasynth, like E-mu's hardware, applies 0.4 of it). A level beyond what a sample at full scale can reach is reported as too loud. Level 0 dB is calibrated to about the loudness of MS Basic's Choir Aahs at mf (`npm test` prints both).
- **Dynamics:** the tone's instrument replaces the default velocity-to-volume modulator with one of amount 0, and adds CC2 to volume (concave, like the velocity's) and CC2 to the filter cutoff, which makes soft notes darker. The attack's instrument keeps velocity to volume, with its own range, and velocity to the filter. With "Tone follows: velocity", the tone uses the velocity like an ordinary instrument. CC2 is 0 until a MIDI file sets it, which silences a tone that follows CC2: MuseScore's files set it for every note, and the keyboard sends it before each note.
- **Onset:** the modulation envelope makes the tone brighter (Onset bright) and optionally flat (Scoop) at the start of each note, and decays in the Onset time.
- **Playing:** `src/lib/synth/` is a copy of the choir app's synthesizer (`synth.svelte.ts`, `synth-worker.ts`, `synth-worklet.ts`, `synth-engine.ts`, `midi.ts`), so the page plays exactly as the choir app would. The copy can also:
  - take a bank made in memory (`addBank()`), and replace a bank under the same id without resetting the synthesizer: it swaps the bank in spessasynth's sound bank list and calls `refreshPresets()`, so the channels keep their controllers. Adding a bank with `addSoundBank()` resets all controllers and stops all notes, so the engine seeks again after adding a bank while playing, which restores the score's controllers;
  - play MIDI messages at once (`send()`), for the keyboard, on channel 16;
  - load a program's samples for given notes (the keyboard's), not only the score's.
- **Building:** `src/lib/build-worker.ts` builds, writes the SF2 file and reads it back, so that the page plays the file it exports, and renders the preview note with a `SpessaSynthProcessor` of its own. `src/lib/builder.svelte.ts` keeps one build running at a time and drops all but the newest waiting patch. Samples are cached by the parameters they depend on, so most changes don't synthesize anything.

## Limitations

- **File size:** the samples are 16-bit PCM, about 4 MB with the defaults (7 MB in stereo), against 0.65 MB for MS Basic's Ogg Vorbis-compressed Choir Aahs. Shorter loops, a lower sample rate or a wider key spacing make it smaller. Writing SF3 needs an Ogg Vorbis encoder, which spessasynth_core doesn't include.
- **Loops are static:** apart from the ensemble's shimmer, vibrato and tremolo, each tone sample repeats exactly every Loop seconds.
- **Tenor formants only:** the formant table is a tenor's. Sopranos' formants are higher, but their harmonics are so far apart that the formants matter less.
- **Unisons** of several parts on the same key start the same sample at the same place, so they add up exactly rather than like separate voices.
- **Untested:** how the instrument sounds to a singer following it; the tests check levels and modulators, not musical usefulness.

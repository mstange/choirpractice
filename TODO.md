# To do

- [x] **Graph width changes after load.** The timeline used the last measure's time as the duration until the stems were decoded, then rescaled to the stem length, which is 3 s longer. The duration now comes from `piece.json`. The time label no longer switches between a wide "Loading audio…" text and the time, which also shifted the part buttons.
- [x] **Progressive decode.** Stems are now 10 s mp3 chunks, loaded from the playhead on (see README, "Chunks").
- [x] **Microphone pitch.** Done with the McLeod pitch method instead of resonators (see README, "Microphone").
- [ ] **Try the mic with a real voice and a real microphone.** Only tested with a stem fed through a stubbed `getUserMedia`. Things to check:
  - whether the clarity threshold (0.8 in `pitch.ts`) drops too much;
  - how the trail lines up in time: input latency isn't compensated, only half the analysis window is;
  - how echo cancellation behaves without headphones.

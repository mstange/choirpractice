// Writes media/soundfont/<program>.sf3: MuseScore's MS Basic soundfont, one file per General MIDI
// program, for every program that a piece in media/ plays (its score.mid) or that the instrument
// menu offers, except for OWN_PROGRAMS, whose files are checked in. The samples keep their Ogg Vorbis
// compression. Run by tools/build.sh.
//
// Usage: node site/scripts/soundfont.ts
import { copyFileSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BasicSoundBank, SoundBankLoader } from 'spessasynth_core';
import { INSTRUMENTS, OWN_PROGRAMS, soundfontFile } from '../src/lib/instruments.ts';
import { parseMidi } from '../src/lib/midi.ts';

const SOURCE =
	process.env.SOUNDFONT ?? '/Applications/MuseScore 4.app/Contents/Resources/sound/MS Basic.sf3';
const media = new URL('../../media/', import.meta.url).pathname;
const out = `${media}soundfont/`;

const read = (path: string) => {
	const b = readFileSync(path);
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const programs = new Set(INSTRUMENTS.map(([p]) => p));
for (const path of globSync(`${media}*/*/score.mid`)) {
	const { programs: played } = parseMidi(read(path));
	// Channel 10 plays drum kits, which the page doesn't load.
	if (played.has(9)) throw new Error(`${path}: percussion (MIDI channel 10) isn't supported`);
	for (const program of played.values()) programs.add(program);
}

const source = SoundBankLoader.fromArrayBuffer(read(SOURCE));
mkdirSync(out, { recursive: true });
for (const program of [...programs].filter((p) => !OWN_PROGRAMS.has(p)).sort((a, b) => a - b)) {
	const preset = source.presets.find(
		(p) => p.program === program && p.bankMSB === 0 && p.bankLSB === 0 && !p.isGMGSDrum
	);
	if (!preset) throw new Error(`${SOURCE} has no preset for program ${program}`);
	const bank = new BasicSoundBank();
	bank.soundBankInfo = {
		...source.soundBankInfo,
		name: `${source.soundBankInfo.name}: ${preset.name}`
	};
	bank.clonePreset(preset);
	bank.flush();
	const file = soundfontFile(program);
	writeFileSync(`${out}${file}`, new Uint8Array(bank.writeSF2({ writeDefaultModulators: true })));
	console.log(`${file}: ${preset.name}, ${bank.samples.length} samples`);
}
// The MIT license asks for its notice to go with any copy.
copyFileSync(SOURCE.replace(/\.sf3$/, '_License.md'), `${out}LICENSE.md`);

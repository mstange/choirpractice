// Writes media/soundfont/<program>.sf3: MuseScore's MS Basic soundfont, one file per General MIDI
// program, for every program that a piece in media/ plays (its score.mid) or that the instrument
// menu offers, except for OWN_PROGRAMS, whose files are checked in. The samples keep their Ogg Vorbis
// compression. Run by tools/build.sh.
//
// The metronome's program, METRONOME, is instead the high and low wood block of the Standard drum
// kit (METRONOME_KEYS), which MuseScore's metronome plays.
//
// Usage: node site/scripts/soundfont.ts
import { copyFileSync, globSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { BasicSoundBank, SoundBankLoader, type BasicPreset } from 'spessasynth_core';
import {
	INSTRUMENTS,
	METRONOME,
	METRONOME_KEYS,
	OWN_PROGRAMS,
	soundfontFile
} from '../src/lib/instruments.ts';
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
if (programs.has(METRONOME))
	throw new Error(
		`program ${METRONOME} is the metronome's, but a piece or the instrument menu plays it`
	);

const source = SoundBankLoader.fromArrayBuffer(read(SOURCE));
mkdirSync(out, { recursive: true });

/** Writes a file of one preset of the source, as `program`, keeping the samples of `keys` if given. */
function write(preset: BasicPreset, program: number, keys?: number[]) {
	const bank = new BasicSoundBank();
	bank.soundBankInfo = {
		...source.soundBankInfo,
		name: `${source.soundBankInfo.name}: ${preset.name}`
	};
	const copy = bank.clonePreset(preset);
	Object.assign(copy, { program, bankMSB: 0, bankLSB: 0, isGMGSDrum: false });
	const velocities = new Set(Array.from({ length: 128 }, (_, v) => v));
	if (keys) bank.trim(new Map([[copy, new Map(keys.map((k) => [k, velocities]))]]));
	bank.flush();
	const file = soundfontFile(program);
	writeFileSync(`${out}${file}`, new Uint8Array(bank.writeSF2({ writeDefaultModulators: true })));
	console.log(`${file}: ${preset.name}, ${bank.samples.map((s) => s.name).join(', ')}`);
}

for (const program of [...programs].filter((p) => !OWN_PROGRAMS.has(p)).sort((a, b) => a - b)) {
	const preset = source.presets.find(
		(p) => p.program === program && p.bankMSB === 0 && p.bankLSB === 0 && !p.isGMGSDrum
	);
	if (!preset) throw new Error(`${SOURCE} has no preset for program ${program}`);
	write(preset, program);
}
const kit = source.presets.find((p) => p.isGMGSDrum && p.program === 0);
if (!kit) throw new Error(`${SOURCE} has no Standard drum kit`);
write(kit, METRONOME, Object.values(METRONOME_KEYS));
// The MIT license asks for its notice to go with any copy.
copyFileSync(SOURCE.replace(/\.sf3$/, '_License.md'), `${out}LICENSE.md`);

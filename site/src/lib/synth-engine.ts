import { SoundBankLoader, SpessaSynthProcessor, type BasicSoundBank } from 'spessasynth_core';
import { formantsAt, Slide, type FormantTable } from './formants.ts';

/** Seconds in which a channel's gain gets most of the way to a new value. */
const GAIN_TIME = 0.05;

/**
 * A MIDI channel message other than a program change, at a time in the score in seconds. `offset`
 * is added to the message's channel, for the channels beyond the score's 16. Since the page sets
 * each channel's program, a bank select (CC 0) plays the program's preset in that bank from the
 * next note on, or the program's first preset if its bank has none there.
 *
 * A note-on with `legato` doesn't start a note of its own: the note `from` of its channel, whose
 * note-off comes just before, crossfades into it over `fade` seconds, and it goes on from where
 * that note's envelopes and samples have got to, without an attack.
 *
 * A note-on with `slide` starts with the formants of its program's preset in bank `bank`, which
 * move to those of the preset that it plays over `seconds`, if the program has a formant table
 * (see formants.ts).
 */
export type ScoreEvent = {
	t: number;
	data: number[];
	offset?: number;
	legato?: { from: number; fade: number };
	slide?: { bank: number; seconds: number };
};
/**
 * A note of the score, from its note-on to its note-off. A legato note has the `onset` of the
 * note that it goes on from (and that one's, and so on). `bank` is the bank that a bank select
 * gives its channel, if any, so that the samples of that bank's preset are decoded for it.
 */
export type ScoreNote = {
	t0: number;
	t1: number;
	ch: number;
	key: number;
	vel: number;
	onset?: number;
	bank?: number;
};
/** A sample of a sound bank, decoded: its index in the bank's samples, and its data. */
export type DecodedSample = { index: number; data: Float32Array };

/**
 * What the page tells the engine. Playing and stopping happen at a sample frame of the audio
 * context, so that the page knows the score position of every frame without being told.
 */
export type Message =
	/** With `at`, the score replaces the one playing at a frame, and plays from `pos` there. */
	| ScoreMessage
	| { type: 'bank'; id: string; buffer?: ArrayBuffer; samples: DecodedSample[] }
	| { type: 'program'; ch: number; program: number }
	| { type: 'gain'; ch: number; gain: number }
	| { type: 'formants'; program: number; table: FormantTable | null }
	/** A MIDI message to play now, such as a note from a keyboard. */
	| { type: 'midi'; data: number[]; offset?: number }
	| PlayCommand;

type ScoreMessage = {
	type: 'score';
	events: ScoreEvent[];
	notes: ScoreNote[];
	at?: { frame: number; pos: number; rate: number; loop: [number, number] | null };
};

/**
 * Starts playing at `frame` from `pos`, `rate` seconds of the score per second, repeating `loop`
 * once playback reaches its end. With `seek` false, playback carries on from where it is and only
 * the rate changes.
 */
type PlayCommand =
	| {
			type: 'play';
			frame: number;
			pos: number;
			rate: number;
			loop: [number, number] | null;
			seek: boolean;
	  }
	| { type: 'stop'; frame: number }
	| (ScoreMessage & { frame: number });

/** The fields of spessasynth_core's internal voices that starting a note part-way through needs. */
interface Voice {
	isActive: boolean;
	isInRelease: boolean;
	isHeld: boolean;
	channel: number;
	midiNote: number;
	noteID: number;
	gainModifier: number;
	startTime: number;
	releaseStartTime: number;
	vibLfoStartTime: number;
	modLfoStartTime: number;
	targetKey: number;
	rootKey: number;
	vibLfoPhase: number;
	modLfoPhase: number;
	modEnv: { init(voice: Voice): void };
	modEnv2: { init(voice: Voice): void };
	volEnv: { sampleTime: number };
	wavetable: {
		process(n: number, ratio: number, buffer: Float32Array): boolean;
		sampleData: Float32Array | undefined;
		cursor: number;
		end: number;
		playbackStep: number;
		isLooping: boolean;
		loopStart: number;
		loopLength: number;
		hasLooped: boolean;
	};
	exclusiveRelease(currentTime: number): void;
}

/** The fields of spessasynth_core's internal channels that pair a note-off with its voices. */
interface Channel {
	noteOnID: number[];
	playingNotes: boolean[];
}

/**
 * A voice's gain going from `gain` to silence, or from silence to `gain`, in the legato: at equal
 * power, or, between two voices that play the same, at equal gain. `voiceStart` is the voice's
 * start time, which tells whether spessasynth has since given the voice to another note.
 */
type Fade = {
	voice: Voice;
	voiceStart: number;
	gain: number;
	start: number;
	seconds: number;
	out: boolean;
	power: boolean;
};

/**
 * Plays a score with spessasynth_core, sample-exactly: each event happens on the first frame at
 * which the score reaches its time. Runs in the audio thread (see synth-worklet.ts), which must
 * never wait for samples to decode, so the page hands it every sample it will play decoded.
 */
export class Engine {
	readonly synth: SpessaSynthProcessor;
	#rate: number;
	#events: ScoreEvent[] = [];
	#notes: ScoreNote[] = [];
	#banks = new Map<string, BasicSoundBank>();
	/** Per channel, the gain it approaches and the gain it has. */
	#gains = new Map<number, { target: number; gain: number }>();
	#commands: PlayCommand[] = [];
	/** The frame of the audio context that render() renders first. */
	#frame = 0;
	/** While playing: the score position at #frame. */
	#play: { pos: number; rate: number; loop: [number, number] | null } | null = null;
	/** The next event to dispatch. */
	#next = 0;
	#fades: Fade[] = [];
	/** The formant tables of programs, by program. */
	#formants = new Map<number, FormantTable>();

	constructor(sampleRate: number) {
		this.#rate = sampleRate;
		this.synth = new SpessaSynthProcessor(sampleRate, { effectsEnabled: true });
	}

	/** spessasynth_core's pool of voices, active or not. */
	get #voices() {
		return (this.synth as unknown as { voices: Voice[] }).voices;
	}

	receive(m: Message) {
		const synth = this.synth;
		if (m.type === 'score' && !m.at) {
			this.#events = m.events;
			this.#notes = m.notes;
		} else if (m.type === 'score') {
			this.#commands.push({ ...m, frame: m.at!.frame });
			this.#commands.sort((a, b) => a.frame - b.frame);
		} else if (m.type === 'bank') {
			// With a buffer, the bank is new or replaces the one of this id.
			let bank = this.#banks.get(m.id);
			if (m.buffer) {
				bank = SoundBankLoader.fromArrayBuffer(m.buffer);
				this.#banks.set(m.id, bank);
				const entry = synth.soundBankManager.soundBankList.find((e) => e.id === m.id);
				if (entry) {
					// Unlike adding a bank, this doesn't reset the synthesizer: the channels keep their
					// controllers, the notes that sound go on with the old samples, and the next notes
					// play the new ones.
					entry.soundBank = bank;
					synth.refreshPresets();
				} else {
					// Without a reset: the channels keep their controllers (programs, gains) and the notes
					// that sound go on, as a bank arrives while playing (a new rendering's instrument).
					synth.soundBankManager.addSoundBank(bank, m.id, 0, false);
				}
			}
			for (const { index, data } of m.samples) {
				const sample = bank!.samples[index];
				sample.setAudioData(data, sample.sampleRate);
			}
		} else if (m.type === 'program') {
			this.#program(m.ch, m.program);
		} else if (m.type === 'gain') {
			const g = this.#gains.get(m.ch);
			if (g) g.target = m.gain;
			else {
				this.#gains.set(m.ch, { target: m.gain, gain: m.gain });
				this.#channel(m.ch).setSystemParameter('gain', m.gain);
			}
		} else if (m.type === 'formants') {
			if (m.table) this.#formants.set(m.program, m.table);
			else this.#formants.delete(m.program);
		} else if (m.type === 'midi') {
			this.#channel((m.data[0] & 0x0f) + (m.offset ?? 0));
			this.#message(m.data, m.offset);
		} else if (m.type === 'stop') {
			// It cancels playing that hasn't started yet, but not a score that replaces another.
			for (const c of this.#commands)
				if (c.type === 'score') [this.#events, this.#notes] = [c.events, c.notes];
			this.#commands = [m];
		} else {
			this.#commands.push(m);
			this.#commands.sort((a, b) => a.frame - b.frame);
		}
	}

	/**
	 * Plays channel `ch` with `program`, in the bank that it has, whatever the score's events do.
	 */
	#program(ch: number, program: number, bank?: number) {
		const channel = this.#channel(ch);
		if (bank !== undefined) channel.patch.bankMSB = bank;
		channel.setSystemParameter('presetLock', false);
		this.synth.programChange(ch, program);
		channel.setSystemParameter('presetLock', true);
	}

	/** Plays a MIDI message: a bank select changes the channel's preset (see ScoreEvent). */
	#message(data: number[], offset?: number) {
		if ((data[0] & 0xf0) === 0xb0 && data[1] === 0) {
			const ch = (data[0] & 0x0f) + (offset ?? 0);
			this.#program(ch, this.#channel(ch).patch.program, data[2]);
		} else this.synth.processMessage(data, offset);
	}

	/** The synthesizer's channel `ch`, which it creates, and those before it, if it hasn't yet. */
	#channel(ch: number) {
		while (this.synth.midiChannels.length <= ch) this.synth.createMIDIChannel();
		return this.synth.midiChannels[ch];
	}

	/**
	 * Renders the frames from `frame` on into `left` and `right`, which it adds to. `frame` counts
	 * the audio context's frames, the clock of the page's commands, which started before this did.
	 */
	render(frame: number, left: Float32Array, right: Float32Array) {
		const n = left.length;
		this.#frame = frame;
		// A gain changes in small steps, which add up to an exponential approach.
		const step = 1 - Math.exp(-n / (GAIN_TIME * this.#rate));
		for (const [ch, g] of this.#gains) {
			if (g.gain === g.target) continue;
			g.gain = Math.abs(g.target - g.gain) < 1e-4 ? g.target : g.gain + (g.target - g.gain) * step;
			this.synth.midiChannels[ch].setSystemParameter('gain', g.gain);
		}
		for (let i = 0; i < n;) {
			while (this.#commands.length && this.#commands[0].frame <= this.#frame + i)
				this.#apply(this.#commands.shift()!);
			let end = n;
			if (this.#commands.length) end = Math.min(end, this.#commands[0].frame - this.#frame);
			const play = this.#play;
			// Playback that starts after the loop's end doesn't repeat it.
			const loopEnd = play?.loop && play.pos < play.loop[1] ? play.loop[1] : Infinity;
			if (play) {
				this.#dispatch(play.pos);
				// Render up to the frame at which the score reaches the next event or the loop's end.
				const until = Math.min(this.#events[this.#next]?.t ?? Infinity, loopEnd);
				const frames = Math.ceil(((until - play.pos) / play.rate) * this.#rate);
				end = Math.min(end, i + Math.max(1, frames));
			}
			if (this.#fades.length) this.#fade();
			this.synth.process(left, right, i, end - i);
			if (play) {
				play.pos += (play.rate * (end - i)) / this.#rate;
				if (play.pos >= loopEnd) {
					play.pos -= play.loop![1] - play.loop![0];
					this.#seek(play.pos, play.rate);
				}
			}
			i = end;
		}
	}

	#apply(c: PlayCommand) {
		if (c.type === 'score') {
			const { pos, rate, loop } = c.at!;
			[this.#events, this.#notes] = [c.events, c.notes];
			this.#play = { pos, rate, loop };
			this.#seek(pos, rate, true);
		} else if (c.type === 'stop') {
			this.#play = null;
			this.#fades = [];
			this.synth.stopAll(false);
		} else if (!c.seek && this.#play) {
			this.#play.rate = c.rate;
		} else {
			this.#play = { pos: c.pos, rate: c.rate, loop: c.loop };
			this.#seek(c.pos, c.rate);
		}
	}

	/** Dispatches the events up to `pos`. */
	#dispatch(pos: number) {
		const events = this.#events;
		while (this.#next < events.length && events[this.#next].t <= pos) {
			const e = events[this.#next++];
			if (e.legato) this.#legato(e);
			else if (e.slide)
				this.#slide(
					e,
					this.#start(() => this.#message(e.data, e.offset))
				);
			else this.#message(e.data, e.offset);
		}
	}

	/** Plays a legato note-on (see ScoreEvent). */
	#legato(e: ScoreEvent) {
		const { data, offset, legato } = e;
		const synth = this.synth,
			now = synth.currentTime,
			ch = (data[0] & 0x0f) + (offset ?? 0),
			{ from, fade } = legato!;
		// The note-off of `from` has just released its voices, which haven't rendered since.
		const held = this.#voices.filter(
			(v) =>
				v.isActive &&
				v.channel === ch &&
				v.midiNote === from &&
				!v.isInRelease &&
				v.releaseStartTime !== Infinity
		);
		if (!held.length) {
			const started = this.#start(() => synth.processMessage(data, offset));
			if (e.slide) this.#slide(e, started);
			return;
		}
		const since = now - Math.min(...held.map((v) => v.startTime));
		this.#fades = this.#fades.filter((f) => !held.includes(f.voice));
		for (const v of held) v.releaseStartTime = Infinity;
		const started = this.#start(() => synth.processMessage(data, offset));
		// A voice that plays the sample of one that ends goes on from where that one is, so that the
		// waveform carries on; at the same key, as on an instrument without vowels, the two play the
		// same, which a crossfade at equal gain keeps as loud.
		const twins = new Set<Voice>(),
			fadeOf = (voice: Voice, out: boolean, power: boolean): Fade => ({
				voice,
				voiceStart: voice.startTime,
				gain: voice.gainModifier,
				start: now,
				seconds: fade,
				out,
				power
			});
		for (const v of started) {
			advance(v, since, this.#rate);
			const old = same(v, held);
			if (old) {
				v.wavetable.cursor = old.wavetable.cursor;
				v.wavetable.hasLooped = old.wavetable.hasLooped;
				v.vibLfoPhase = old.vibLfoPhase;
				v.modLfoPhase = old.modLfoPhase;
				if (data[1] === from) twins.add(old);
			}
			this.#fades.push(fadeOf(v, false, !(old && twins.has(old))));
			v.gainModifier = 0;
		}
		for (const v of held) this.#fades.push(fadeOf(v, true, !twins.has(v)));
		if (e.slide) this.#slide(e, started);
	}

	/** Gives the voices that a note-on with `slide` started their slide (see ScoreEvent). */
	#slide({ data, offset, slide }: ScoreEvent, voices: Voice[]) {
		const channel = this.#channel((data[0] & 0x0f) + (offset ?? 0)),
			table = this.#formants.get(channel.patch.program);
		if (!table) return;
		for (const v of voices) {
			const from = formantsAt(table, slide!.bank, v.midiNote),
				to = formantsAt(table, channel.patch.bankMSB, v.midiNote);
			if (from && to) filter(v, new Slide(from, to, slide!.seconds, this.#rate));
		}
	}

	/** Calls `noteOn`, and returns the voices that it started. */
	#start(noteOn: () => void) {
		const voices = this.#voices,
			before = new Set(voices.filter((v) => v.isActive));
		noteOn();
		return voices.filter((v) => v.isActive && !before.has(v));
	}

	/**
	 * Moves the legato's gains on. A voice that has faded out ends. A voice can also end before its
	 * fade does, such as one of a sample without a loop that advance() moved past its end, and
	 * spessasynth then gives it to the next note that starts, which its fade mustn't touch.
	 */
	#fade() {
		const now = this.synth.currentTime;
		this.#fades = this.#fades.filter((f) => {
			if (!f.voice.isActive || f.voice.startTime !== f.voiceStart) return false;
			const x = Math.min(1, (now - f.start) / f.seconds),
				y = f.out ? 1 - x : x;
			f.voice.gainModifier = f.gain * (f.power ? Math.sin((y * Math.PI) / 2) : y);
			if (x < 1) return true;
			if (f.out) f.voice.exclusiveRelease(now);
			return false;
		});
	}

	/**
	 * Releases the notes that sound, and goes to `pos`: sets the controllers as the events before
	 * it left them, and starts the notes that sound at `pos` part-way through, as if they had
	 * played since their start at `rate` (a legato note since the start of the notes it goes on
	 * from). With `carry` (a score that replaces another), a note that sounds at `pos` on a
	 * channel and key that sound already goes on in their voices, rather than starting again
	 * while they fade out, which sounded like playing it twice.
	 */
	#seek(pos: number, rate: number, carry = false) {
		const synth = this.synth,
			events = this.#events;
		const sounding = carry
			? this.#voices.filter((v) => v.isActive && v.releaseStartTime === Infinity && !v.isHeld)
			: [];
		synth.stopAll(false);
		const carried = new Set<Voice>();
		this.#next = 0;
		for (; this.#next < events.length && events[this.#next].t < pos; this.#next++) {
			const { data, offset } = events[this.#next];
			if ((data[0] & 0xe0) !== 0x80) this.#message(data, offset); // all but note-on and note-off
		}
		for (const note of this.#notes) {
			if (note.t0 >= pos || note.t1 <= pos) continue;
			const going = sounding.filter((v) => v.channel === note.ch && v.midiNote === note.key);
			if (going.length) {
				// Undoes stopAll() for them, and counts them as the channel's note-on of the key, so
				// that the score's note-off releases them.
				const channel = this.#channel(note.ch) as unknown as Channel;
				const id = channel.noteOnID[note.key]++;
				channel.playingNotes[note.key] = true;
				for (const v of going) {
					v.releaseStartTime = Infinity;
					v.noteID = id;
					sounding.splice(sounding.indexOf(v), 1);
					carried.add(v);
				}
				continue;
			}
			const since = (pos - (note.onset ?? note.t0)) / rate;
			for (const v of this.#start(() => synth.noteOn(note.ch, note.key, note.vel)))
				advance(v, since, this.#rate);
		}
		// A voice carried on in the middle of a legato's crossfade fades in to the end.
		this.#fades = this.#fades.filter((f) => carried.has(f.voice));
	}
}

/** The voice of `voices` that plays the same sample as `v`, if any. */
const same = (v: Voice, voices: Voice[]) =>
	voices.find((o) => o.wavetable.sampleData === v.wavetable.sampleData);

/**
 * Moves a voice that hasn't rendered yet `seconds` on: its envelopes, its LFOs and its place in
 * the sample. The place ignores the tuning finer than the key, which only matters within the
 * sample's loop, where any place sounds alike.
 */
function advance(v: Voice, seconds: number, sampleRate: number) {
	v.startTime -= seconds;
	v.vibLfoStartTime -= seconds;
	v.modLfoStartTime -= seconds;
	v.modEnv.init(v);
	v.modEnv2.init(v);
	v.volEnv.sampleTime = Math.round(seconds * sampleRate);
	const w = v.wavetable;
	w.cursor += seconds * sampleRate * w.playbackStep * 2 ** ((v.targetKey - v.rootKey) / 12);
	if (w.isLooping && w.cursor >= w.loopStart + w.loopLength) {
		w.cursor = w.loopStart + ((w.cursor - w.loopStart) % w.loopLength);
		w.hasLooped = true;
	}
	// A sample without a loop may have ended, like a piano note that died away; then the voice ends
	// when it renders.
}

/** The slide of each voice's oscillator that has one, and the voice's start then. */
const slides = new WeakMap<object, { slide: Slide; voice: Voice; start: number }>();
const patched = new WeakSet<object>();

/**
 * Filters the samples of `voice` with `slide` while it lasts: right after its oscillator renders
 * them, before the voice's gain, pan and effect sends, so that its reverb has the slide too.
 */
function filter(voice: Voice, slide: Slide) {
	const proto = Object.getPrototypeOf(voice.wavetable);
	if (!patched.has(proto)) {
		patched.add(proto);
		const process = proto.process;
		proto.process = function (this: object, n: number, ratio: number, buffer: Float32Array) {
			const active = process.call(this, n, ratio, buffer),
				s = slides.get(this);
			// A voice that started another note since has nothing to do with the slide.
			if (s && (s.voice.startTime !== s.start || !s.slide.run(buffer, n))) slides.delete(this);
			return active;
		};
	}
	slides.set(voice.wavetable, { slide, voice, start: voice.startTime });
}

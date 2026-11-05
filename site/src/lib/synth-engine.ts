import { SoundBankLoader, SpessaSynthProcessor, type BasicSoundBank } from 'spessasynth_core';

/** Seconds in which a channel's gain gets most of the way to a new value. */
const GAIN_TIME = 0.05;

/** A MIDI channel message other than a program change, at a time in the score in seconds. */
export type ScoreEvent = { t: number; data: number[] };
/** A note of the score, from its note-on to its note-off. */
export type ScoreNote = { t0: number; t1: number; ch: number; key: number; vel: number };
/** A sample of a sound bank, decoded: its index in the bank's samples, and its data. */
export type DecodedSample = { index: number; data: Float32Array };

/**
 * What the page tells the engine. Playing and stopping happen at a sample frame of the audio
 * context, so that the page knows the score position of every frame without being told.
 */
export type Message =
	| { type: 'score'; events: ScoreEvent[]; notes: ScoreNote[] }
	| { type: 'bank'; id: string; buffer?: ArrayBuffer; samples: DecodedSample[] }
	| { type: 'program'; ch: number; program: number }
	| { type: 'gain'; ch: number; gain: number }
	| PlayCommand;

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
	| { type: 'stop'; frame: number };

/** The fields of spessasynth_core's internal voices that starting a note part-way through needs. */
interface Voice {
	isActive: boolean;
	startTime: number;
	vibLfoStartTime: number;
	modLfoStartTime: number;
	targetKey: number;
	rootKey: number;
	modEnv: { init(voice: Voice): void };
	modEnv2: { init(voice: Voice): void };
	volEnv: { sampleTime: number };
	wavetable: {
		cursor: number;
		end: number;
		playbackStep: number;
		isLooping: boolean;
		loopStart: number;
		loopLength: number;
		hasLooped: boolean;
	};
}

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
	/** The next frame to render. */
	#frame = 0;
	/** While playing: the score position at #frame. */
	#play: { pos: number; rate: number; loop: [number, number] | null } | null = null;
	/** The next event to dispatch. */
	#next = 0;

	constructor(sampleRate: number) {
		this.#rate = sampleRate;
		this.synth = new SpessaSynthProcessor(sampleRate, { effectsEnabled: true });
	}

	receive(m: Message) {
		const synth = this.synth;
		if (m.type === 'score') {
			this.#events = m.events;
			this.#notes = m.notes;
		} else if (m.type === 'bank') {
			let bank = this.#banks.get(m.id);
			if (!bank) {
				bank = SoundBankLoader.fromArrayBuffer(m.buffer!);
				this.#banks.set(m.id, bank);
				synth.soundBankManager.addSoundBank(bank, m.id);
			}
			for (const { index, data } of m.samples) {
				const sample = bank.samples[index];
				sample.setAudioData(data, sample.sampleRate);
			}
		} else if (m.type === 'program') {
			// The program stays, whatever the score's events do.
			const channel = synth.midiChannels[m.ch];
			channel.setSystemParameter('presetLock', false);
			synth.programChange(m.ch, m.program);
			channel.setSystemParameter('presetLock', true);
		} else if (m.type === 'gain') {
			const g = this.#gains.get(m.ch);
			if (g) g.target = m.gain;
			else {
				this.#gains.set(m.ch, { target: m.gain, gain: m.gain });
				synth.midiChannels[m.ch].setSystemParameter('gain', m.gain);
			}
		} else if (m.type === 'stop') {
			// It cancels playing that hasn't started yet.
			this.#commands = [m];
		} else {
			this.#commands.push(m);
			this.#commands.sort((a, b) => a.frame - b.frame);
		}
	}

	/** Renders the frames from #frame on into `left` and `right`, which it adds to. */
	render(left: Float32Array, right: Float32Array) {
		const n = left.length;
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
		this.#frame += n;
	}

	#apply(c: PlayCommand) {
		if (c.type === 'stop') {
			this.#play = null;
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
		while (this.#next < events.length && events[this.#next].t <= pos)
			this.synth.processMessage(events[this.#next++].data);
	}

	/**
	 * Releases the notes that sound, and goes to `pos`: sets the controllers as the events before
	 * it left them, and starts the notes that sound at `pos` part-way through, as if they had
	 * played since their start at `rate`.
	 */
	#seek(pos: number, rate: number) {
		const synth = this.synth,
			events = this.#events;
		synth.stopAll(false);
		this.#next = 0;
		for (; this.#next < events.length && events[this.#next].t < pos; this.#next++) {
			const data = events[this.#next].data;
			if ((data[0] & 0xe0) !== 0x80) synth.processMessage(data); // all but note-on and note-off
		}
		const voices = (synth as unknown as { voices: Voice[] }).voices;
		for (const note of this.#notes) {
			if (note.t0 >= pos || note.t1 <= pos) continue;
			const before = new Set(voices.filter((v) => v.isActive));
			synth.noteOn(note.ch, note.key, note.vel);
			for (const v of voices)
				if (v.isActive && !before.has(v)) advance(v, (pos - note.t0) / rate, this.#rate);
		}
	}
}

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

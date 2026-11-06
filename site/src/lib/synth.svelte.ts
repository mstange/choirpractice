import { soundfontFile } from './instruments.ts';
import type { Message } from './synth-engine.ts';
import type { MidiReply, Request, SamplesReply } from './synth-worker.ts';
import workletUrl from './synth-worklet.ts?worker&url';
import type { Part } from './types.ts';

/** Seconds between asking the audio thread to start playing and the start. */
const LEAD = 0.05;
/** The General MIDI program that can double the vocal parts. */
const PIANO = 0;
/**
 * The velocity of the piano that doubles a note of this velocity: it follows the part's dynamics
 * in the upper half of the range, since a soft piano note is hard to hear beside a choir sound.
 */
const pianoVelocity = (vel: number) => (vel ? Math.round(64 + vel / 2) : 0);

/**
 * Plays a piece's score.mid with soundfont instruments, each part on its MIDI channels.
 *
 * The audio thread (synth-engine.ts) plays the score from a position at a rate; the page tells it
 * at which sample frame to start, so it knows the position of every later frame. A worker reads
 * the MIDI file and decodes every soundfont sample before the audio thread needs it, only the ones
 * that the notes of a channel use. Until the instruments have loaded, playing waits.
 *
 * Each vocal part also plays its notes on a piano, on a channel of its own beyond the score's 16,
 * which stays silent until setPianoGain().
 */
export class Synth {
	/** Whether the user wants playback, even while waiting. */
	playing = $state(false);
	/** Playing, but held, or the instruments haven't loaded yet. */
	waiting = $state(false);
	error = $state('');
	readonly duration: number;

	#ctx = new AudioContext({ latencyHint: 'playback' });
	#node: AudioWorkletNode | undefined;
	/** Messages for the audio thread from before it was there. */
	#queue: [Message, Transferable[]][] = [];
	#worker = new Worker(new URL('./synth-worker.ts', import.meta.url), { type: 'module' });
	#requests = new Map<number, [(reply: never) => void, (error: Error) => void]>();
	#nextId = 0;
	#parts: Part[];
	#soundfontUrl: (file: string) => string;
	/** Per channel, the [key, velocity] of its notes, each once. */
	#notes = new Map<number, [number, number][]>();
	/** Per vocal part, the channel of its piano. */
	#pianos = new Map<string, number>();
	/**
	 * The channels of the vocal parts, which play #vocalProgram instead of the score's program. A
	 * part with several channels, such as a cello's arco and pizzicato, keeps its programs.
	 */
	#vocal: number[];
	#vocalProgram: number;
	/** Whether the score has been read, so that the notes of each channel are known. */
	#scored = false;
	/** Per channel, a count of program changes, so that only the latest one takes effect. */
	#changes = new Map<number, number>();
	#ready = false;
	#held = false;
	/** The position while not sounding. */
	#offset = 0;
	#rate = 1;
	#loop: [number, number] | null = null;
	/** While sounding: playback is at `pos` at context time `time`, with this loop. */
	#anchor: { time: number; pos: number; loop: [number, number] | null } | null = null;

	constructor(
		parts: Part[],
		duration: number,
		soundfontUrl: (file: string) => string,
		vocalProgram: number
	) {
		this.#parts = parts;
		this.#vocal = parts.filter((p) => p.vocal && p.channels.length === 1).map((p) => p.channels[0]);
		this.#vocalProgram = vocalProgram;
		this.duration = duration;
		this.#soundfontUrl = soundfontUrl;
		// Channel 9 of every 16 plays drum kits.
		let next = 16;
		for (const { name, vocal, channels } of parts) {
			if (!vocal || !channels.length) continue;
			if (next % 16 === 9) next++;
			this.#pianos.set(name, next++);
		}
		this.#worker.onmessage = ({ data }) => {
			const [resolve, reject] = this.#requests.get(data.id)!;
			this.#requests.delete(data.id);
			if ('error' in data) reject(new Error(data.error));
			else resolve(data.reply as never);
		};
	}

	/** Loads the score and its instruments. */
	async load(midiUrl: string) {
		try {
			await this.#ctx.audioWorklet.addModule(workletUrl);
			this.#node = new AudioWorkletNode(this.#ctx, 'synth', {
				numberOfInputs: 0,
				outputChannelCount: [2]
			});
			this.#node.connect(this.#ctx.destination);
			for (const [m, transfer] of this.#queue) this.#node.port.postMessage(m, transfer);
			this.#queue = [];

			const { events, notes, programs } = await this.#request<MidiReply>({
				type: 'midi',
				url: midiUrl
			});
			// The channel of each score channel's piano.
			const piano = new Map(
				this.#parts.flatMap((p) =>
					this.#pianos.has(p.name) ? p.channels.map((ch) => [ch, this.#pianos.get(p.name)!]) : []
				)
			);
			// The piano gets the part's notes, at pianoVelocity(), and its volume, pan and expression,
			// so that it sits at the level of the part it doubles.
			const doubled = events.flatMap((e) => {
				const type = e.data[0] & 0xf0,
					ch = piano.get(e.data[0] & 0x0f);
				const copied =
					type === 0x80 || type === 0x90 || (type === 0xb0 && [7, 10, 11].includes(e.data[1]));
				if (ch === undefined || !copied) return [e];
				const data =
					type === 0x90 ? [type, e.data[1], pianoVelocity(e.data[2])] : [type, ...e.data.slice(1)];
				return [e, { t: e.t, data, offset: ch }];
			});
			notes.push(
				...notes
					.filter((n) => piano.has(n.ch))
					.map((n) => ({ ...n, ch: piano.get(n.ch)!, vel: pianoVelocity(n.vel) }))
			);
			this.#post({ type: 'score', events: doubled, notes });
			for (const n of notes) {
				const list = this.#notes.get(n.ch) ?? [];
				if (!list.some(([k, v]) => k === n.key && v === n.vel)) list.push([n.key, n.vel]);
				this.#notes.set(n.ch, list);
			}
			this.#scored = true;
			const loads = [];
			for (const { channels } of this.#parts)
				for (const ch of channels)
					loads.push(
						this.#setProgram(
							ch,
							this.#vocal.includes(ch) ? this.#vocalProgram : (programs.get(ch) ?? 0)
						)
					);
			for (const ch of this.#pianos.values()) loads.push(this.#setProgram(ch, PIANO));
			await Promise.all(loads);
			this.#ready = true;
			if (this.playing && this.waiting) this.#start();
		} catch (e) {
			if (!this.error) this.error = String((e as Error).message ?? e);
		}
	}

	#request<T>(req: Request): Promise<T> {
		const id = this.#nextId++;
		// The worker would resolve a relative URL against its own.
		this.#worker.postMessage({ ...req, id, url: new URL(req.url, document.baseURI).href });
		return new Promise((resolve, reject) => this.#requests.set(id, [resolve, reject]));
	}

	#post(m: Message, transfer: Transferable[] = []) {
		if (this.#node) this.#node.port.postMessage(m, transfer);
		else this.#queue.push([m, transfer]);
	}

	/** Plays the vocal parts with another General MIDI program. */
	async setVocalProgram(program: number) {
		if (program === this.#vocalProgram) return;
		this.#vocalProgram = program;
		// Until then, load() picks it up.
		if (!this.#scored) return;
		try {
			await Promise.all(this.#vocal.map((ch) => this.#setProgram(ch, program)));
		} catch (e) {
			if (!this.error) this.error = String((e as Error).message ?? e);
		}
	}

	async #setProgram(ch: number, program: number) {
		const change = (this.#changes.get(ch) ?? 0) + 1;
		this.#changes.set(ch, change);
		const id = this.#soundfontUrl(soundfontFile(program));
		const { buffer, samples } = await this.#request<SamplesReply>({
			type: 'samples',
			url: id,
			notes: this.#notes.get(ch) ?? []
		});
		const transfer = [...samples.map((s) => s.data.buffer), ...(buffer ? [buffer] : [])];
		this.#post({ type: 'bank', id, buffer, samples }, transfer);
		if (this.#changes.get(ch) === change) this.#post({ type: 'program', ch, program });
	}

	now() {
		if (!this.#anchor) return this.#offset;
		const latency = (this.#ctx.baseLatency || 0) + (this.#ctx.outputLatency || 0);
		return this.#posAt(this.#ctx.currentTime - latency);
	}

	/** The position at context time `time`, the same way the audio thread counts it. */
	#posAt(time: number) {
		const { time: t0, pos, loop } = this.#anchor!;
		const p = pos + Math.max(0, time - t0) * this.#rate;
		if (!loop || pos >= loop[1] || p < loop[1]) return p;
		return loop[0] + ((p - loop[1]) % (loop[1] - loop[0]));
	}

	/** The first sample frame at least LEAD seconds from now. */
	#soon() {
		return Math.ceil((this.#ctx.currentTime + LEAD) * this.#ctx.sampleRate);
	}

	play() {
		if (this.playing) return;
		if (this.#offset >= this.duration) this.#offset = 0;
		this.#ctx.resume();
		this.playing = true;
		this.#start();
	}

	/** Starts sounding at #offset, or waits. */
	#start() {
		this.waiting = this.#held || !this.#ready;
		if (this.waiting) return;
		const frame = this.#soon(),
			pos = this.#offset,
			loop = this.#loop;
		this.#anchor = { time: frame / this.#ctx.sampleRate, pos, loop };
		this.#post({ type: 'play', frame, pos, rate: this.#rate, loop, seek: true });
	}

	/** Stops sounding, keeping the position. The notes that sound fade out as if released. */
	#silence() {
		if (!this.#anchor) return;
		this.#offset = this.now();
		this.#anchor = null;
		this.#post({ type: 'stop', frame: 0 });
	}

	get held() {
		return this.#held;
	}

	/** Stops the sound until release(), but stays playing. */
	hold() {
		this.#held = true;
		if (!this.playing) return;
		this.#silence();
		this.waiting = true;
	}

	release() {
		this.#held = false;
		if (this.playing && this.waiting) this.#start();
	}

	pause() {
		if (!this.playing) return;
		this.#silence();
		this.playing = this.waiting = false;
	}

	seek(t: number) {
		const wasPlaying = this.playing;
		this.pause();
		this.#offset = Math.min(Math.max(0, t), this.duration);
		if (wasPlaying) this.play();
	}

	/**
	 * Repeats the range from `loop[0]` to `loop[1]` seconds whenever playback reaches its end, or
	 * stops repeating if null.
	 */
	setLoop(loop: [number, number] | null) {
		if (String(loop) === String(this.#loop)) return;
		const wasPlaying = this.playing;
		this.pause();
		this.#loop = loop;
		if (wasPlaying) this.play();
	}

	/** Plays `rate` seconds of the score per second, carrying on from where playback is. */
	setSpeed(rate: number) {
		if (rate === this.#rate) return;
		if (this.#anchor) {
			const frame = this.#soon(),
				time = frame / this.#ctx.sampleRate;
			this.#anchor = { ...this.#anchor, time, pos: this.#posAt(time) };
			this.#post({ type: 'play', frame, pos: this.#anchor.pos, rate, loop: null, seek: false });
		}
		this.#rate = rate;
	}

	/** Seconds of the score per second. */
	get speed() {
		return this.#rate;
	}

	setGain(part: string, gain: number) {
		for (const ch of this.#parts.find((p) => p.name === part)?.channels ?? [])
			this.#post({ type: 'gain', ch, gain });
	}

	/** Sets the gain of the piano that doubles a vocal part. */
	setPianoGain(part: string, gain: number) {
		const ch = this.#pianos.get(part);
		if (ch !== undefined) this.#post({ type: 'gain', ch, gain });
	}

	close() {
		this.pause();
		this.#worker.terminate();
		this.#ctx.close();
	}
}

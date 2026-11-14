import type { DecodedSample, Message, ScoreEvent, ScoreNote } from './synth-engine.ts';
import type { MidiReply, Request, SamplesReply } from './synth-worker.ts';
import workletUrl from './synth-worklet.ts?worker&url';

/** Seconds between asking the audio thread to start playing and the start. */
const LEAD = 0.05;

/**
 * What the audio thread plays: the score's events and notes, and the General MIDI program of each
 * channel. Channels beyond the score's 16 are given by the `offset` of their events.
 */
export type Score = { events: ScoreEvent[]; notes: ScoreNote[]; programs: Map<number, number> };

type Anchor = {
	time: number;
	pos: number;
	rate: number;
	loop: [number, number] | null;
	prev?: Anchor;
};

/**
 * Plays a MIDI file with soundfont instruments, one General MIDI program per channel.
 *
 * The audio thread (synth-engine.ts) plays the score from a position at a rate; the page tells it
 * at which sample frame to start, so it knows the position of every later frame. A worker reads
 * the MIDI file and decodes every soundfont sample before the audio thread needs it, only the ones
 * that the notes of a channel use. Until the instruments have loaded, playing waits.
 *
 * A subclass can change what is played, and on which instruments, by overriding arrange().
 */
export class Synth {
	/** Whether the user wants playback, even while waiting. */
	playing = $state(false);
	/** Playing, but held, or the instruments haven't loaded yet. */
	waiting = $state(false);
	error = $state('');
	readonly duration: number;

	#ctx = (() => {
		// On iOS, the music then plays even with the ringer switched to silent. While the mic is on,
		// the session is play-and-record instead (see mic.svelte.ts).
		if (navigator.audioSession?.type === 'auto') navigator.audioSession.type = 'playback';
		return new AudioContext({ latencyHint: 'playback' });
	})();
	#node: AudioWorkletNode | undefined;
	/** Messages for the audio thread from before it was there. */
	#queue: [Message, Transferable[]][] = [];
	#worker = new Worker(new URL('./synth-worker.ts', import.meta.url), { type: 'module' });
	#requests = new Map<number, [(reply: never) => void, (error: Error) => void]>();
	#nextId = 0;
	#soundfontUrl: (program: number) => string;
	/** Per channel, the [key, velocity] of its notes, each once. */
	#notes = new Map<number, [number, number][]>();
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
	/**
	 * While sounding: playback is at `pos` at context time `time`, and goes on at `rate` with this
	 * loop. Before `time`, it goes as `prev` says: a speed change takes effect a little later.
	 */
	#anchor: Anchor | null = null;

	/** `soundfontUrl` gives the URL of a General MIDI program's soundfont file. */
	constructor(duration: number, soundfontUrl: (program: number) => string) {
		this.duration = duration;
		this.#soundfontUrl = soundfontUrl;
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

			const { events, notes, programs } = this.arrange(
				await this.#request<MidiReply>({ type: 'midi', url: midiUrl })
			);
			this.#post({ type: 'score', events, notes });
			for (const n of notes) {
				const list = this.#notes.get(n.ch) ?? [];
				if (!list.some(([k, v]) => k === n.key && v === n.vel)) list.push([n.key, n.vel]);
				this.#notes.set(n.ch, list);
			}
			this.#scored = true;
			const loads = [];
			for (const [ch, program] of programs) loads.push(this.setProgram(ch, program));
			await Promise.all(loads);
			this.#ready = true;
			if (this.playing && this.waiting) this.#start();
		} catch (e) {
			this.fail(e);
		}
	}

	/**
	 * What to play of the MIDI file, and on which programs: by default all of it, each channel that
	 * plays notes on the program it has at its first note.
	 */
	protected arrange(midi: MidiReply): Score {
		return midi;
	}

	/** Whether load() has read the score: until then, changing a program waits for arrange(). */
	protected get scored() {
		return this.#scored;
	}

	/** Shows the first error. */
	protected fail(e: unknown) {
		if (!this.error) this.error = String((e as Error).message ?? e);
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

	/**
	 * Plays channel `ch` with another General MIDI program, once its samples are loaded: those that
	 * `notes` ([key, velocity]) need, by default the channel's notes in the score.
	 */
	protected async setProgram(ch: number, program: number, notes = this.#notes.get(ch) ?? []) {
		const change = this.#nextChange(ch);
		const id = this.#soundfontUrl(program);
		const { buffer, samples } = await this.#request<SamplesReply>({
			type: 'samples',
			url: id,
			notes
		});
		const transfer = [...samples.map((s) => s.data.buffer), ...(buffer ? [buffer] : [])];
		this.#post({ type: 'bank', id, buffer, samples }, transfer);
		if (this.#changes.get(ch) === change) this.#post({ type: 'program', ch, program });
	}

	#nextChange(ch: number) {
		const change = (this.#changes.get(ch) ?? 0) + 1;
		this.#changes.set(ch, change);
		return change;
	}

	/**
	 * Adds a sound bank made in memory, all of its samples decoded, or replaces the bank with this
	 * id. Channels that play its presets play the new ones from their next note.
	 */
	addBank(id: string, buffer: ArrayBuffer, samples: DecodedSample[]) {
		this.#post({ type: 'bank', id, buffer, samples }, [
			buffer,
			...samples.map((s) => s.data.buffer)
		]);
	}

	/** Plays channel `ch` with a program of a bank given to addBank(). */
	protected assign(ch: number, program: number) {
		this.#nextChange(ch);
		this.#post({ type: 'program', ch, program });
	}

	/** Plays a MIDI message now, on a channel beyond the score's 16 if `offset` is given. */
	send(data: number[], offset?: number) {
		this.#ctx.resume();
		this.#post({ type: 'midi', data, offset });
	}

	now() {
		if (!this.#anchor) return this.#offset;
		const latency = (this.#ctx.baseLatency || 0) + (this.#ctx.outputLatency || 0);
		return this.#posAt(this.#ctx.currentTime - latency);
	}

	/** The position at context time `time`, the same way the audio thread counts it. */
	#posAt(time: number) {
		let a = this.#anchor!;
		while (a.prev && time < a.time) a = a.prev;
		const { time: t0, pos, rate, loop } = a;
		const p = pos + Math.max(0, time - t0) * rate;
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
		this.#anchor = { time: frame / this.#ctx.sampleRate, pos, rate: this.#rate, loop };
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
			const prev = this.#anchor;
			this.#anchor = { time, pos: this.#posAt(time), rate, loop: prev.loop, prev };
			this.#post({ type: 'play', frame, pos: this.#anchor.pos, rate, loop: null, seek: false });
		}
		this.#rate = rate;
	}

	/** Seconds of the score per second. */
	get speed() {
		return this.#rate;
	}

	/** Sets the gain of channel `ch` (also beyond the score's 16). */
	setChannelGain(ch: number, gain: number) {
		this.#post({ type: 'gain', ch, gain });
	}

	close() {
		this.pause();
		this.#worker.terminate();
		this.#ctx.close();
	}
}

import { soundfontFile } from './instruments.ts';
import type { Message } from './synth-engine.ts';
import type { MidiReply, Request, SamplesReply } from './synth-worker.ts';
import workletUrl from './synth-worklet.ts?worker&url';
import type { Part } from './types.ts';

/** Seconds between asking the audio thread to start playing and the start. */
const LEAD = 0.05;

/**
 * Plays a piece's score.mid with soundfont instruments, each part on its MIDI channels.
 *
 * The audio thread (synth-engine.ts) plays the score from a position at a rate; the page tells it
 * at which sample frame to start, so it knows the position of every later frame. A worker reads
 * the MIDI file and decodes every soundfont sample before the audio thread needs it, only the ones
 * that the notes of a channel use. Until the instruments have loaded, playing waits.
 */
export class Synth {
	/** Whether the user wants playback, even while waiting. */
	playing = $state(false);
	/** Playing, but held, or the instruments haven't loaded yet. */
	waiting = $state(false);
	error = $state('');
	/** The program each part plays, by part name, once the score has loaded. */
	programs: Record<string, number> = $state({});
	/** The program of each part in the score. */
	scorePrograms: Record<string, number> = $state({});
	/** The soundfont's names of the programs loaded so far. */
	names: Record<number, string> = $state({});
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

	constructor(parts: Part[], duration: number, soundfontUrl: (file: string) => string) {
		this.#parts = parts;
		this.duration = duration;
		this.#soundfontUrl = soundfontUrl;
		this.#worker.onmessage = ({ data }) => {
			const [resolve, reject] = this.#requests.get(data.id)!;
			this.#requests.delete(data.id);
			if ('error' in data) reject(new Error(data.error));
			else resolve(data.reply as never);
		};
	}

	/**
	 * Loads the score and its instruments; `instruments` replaces the score's program of some parts,
	 * by part name.
	 */
	async load(midiUrl: string, instruments: Record<string, number>) {
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
			this.#post({ type: 'score', events, notes });
			for (const n of notes) {
				const list = this.#notes.get(n.ch) ?? [];
				if (!list.some(([k, v]) => k === n.key && v === n.vel)) list.push([n.key, n.vel]);
				this.#notes.set(n.ch, list);
			}
			const loads = [];
			for (const { name, channels } of this.#parts) {
				if (!channels.length) continue;
				this.scorePrograms[name] = programs.get(channels[0]) ?? 0;
				// A part with several channels, such as a cello's arco and pizzicato, keeps them all.
				const replaced = channels.length === 1 ? instruments[name] : undefined;
				this.programs[name] = replaced ?? this.scorePrograms[name];
				for (const ch of channels)
					loads.push(this.#setProgram(ch, replaced ?? programs.get(ch) ?? 0));
			}
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

	/** Plays a vocal part with another General MIDI program. */
	async setInstrument(part: string, program: number) {
		const { channels } = this.#parts.find((p) => p.name === part)!;
		this.programs[part] = program;
		try {
			await this.#setProgram(channels[0], program);
		} catch (e) {
			if (!this.error) this.error = String((e as Error).message ?? e);
		}
	}

	async #setProgram(ch: number, program: number) {
		const change = (this.#changes.get(ch) ?? 0) + 1;
		this.#changes.set(ch, change);
		const id = this.#soundfontUrl(soundfontFile(program));
		const { buffer, name, samples } = await this.#request<SamplesReply>({
			type: 'samples',
			url: id,
			notes: this.#notes.get(ch) ?? []
		});
		this.names[program] = name;
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

	close() {
		this.pause();
		this.#worker.terminate();
		this.#ctx.close();
	}
}

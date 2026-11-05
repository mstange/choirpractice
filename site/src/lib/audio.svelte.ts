import type { AudioInfo } from './types.ts';

const FETCHES = 6; // chunk fetches in flight at once
const DECODES = 2; // chunk decodes in flight at once
const AHEAD = 3; // chunks after the playhead's chunk to keep decoded

/**
 * Plays all stems of a piece in sync, each through its own gain node.
 *
 * Each stem comes in chunks (see tools/encode_stems.py). They are fetched starting at the playhead
 * and kept as mp3. Only the chunks from the playhead's on to AHEAD chunks later are decoded, since
 * decoded audio takes about ten times the space. Every chunk is scheduled as its own source node
 * as soon as it is decoded for all parts. The context runs at the stems' sample rate, so chunks
 * line up sample-exactly.
 */
export class Mixer {
	/** Whether the user wants playback, even while waiting for audio. */
	playing = $state(false);
	/** Playing, but held, or the audio at the playhead hasn't arrived yet. */
	waiting = $state(false);
	/** Whether the user holds the playhead, for example while dragging it. Playing resumes on release. */
	#held = false;
	error = $state('');
	readonly duration: number;
	/** Per chunk, whether it has been fetched for all parts. Not reactive; read it while drawing. */
	readonly loaded: boolean[];
	readonly chunkSeconds: number;

	#info: AudioInfo;
	#ctx: AudioContext;
	#names: string[];
	#gains = new Map<string, GainNode>();
	#requested: Set<string>[];
	#mp3s: Map<string, ArrayBuffer>[];
	#decoding: Set<string>[];
	#decodes = 0;
	/** The first chunk of the decoded window. */
	#from = 0;
	#chunks: Map<string, AudioBuffer>[];
	#sources: AudioBufferSourceNode[] = [];
	/** The position while stopped, or where the current run of source nodes started. */
	#offset = 0;
	#startCtx = 0;
	/** The first chunk not yet scheduled in the current run. */
	#next = 0;
	#run = 0;

	constructor(partNames: string[], info: AudioInfo) {
		this.#info = info;
		this.#ctx = new AudioContext({ latencyHint: 'playback', sampleRate: info.rate });
		this.#names = partNames;
		for (const name of partNames) {
			const gain = this.#ctx.createGain();
			gain.connect(this.#ctx.destination);
			this.#gains.set(name, gain);
		}
		this.duration = info.length / info.rate;
		this.chunkSeconds = info.chunk / info.rate;
		const count = Math.ceil(info.length / info.chunk);
		this.loaded = Array(count).fill(false);
		this.#requested = Array.from({ length: count }, () => new Set());
		this.#mp3s = Array.from({ length: count }, () => new Map());
		this.#decoding = Array.from({ length: count }, () => new Set());
		this.#chunks = Array.from({ length: count }, () => new Map());
	}

	/** Fetches all chunks of all stems. `dirs` maps part names to chunk directories. */
	async load(dirs: Record<string, string>, signal: AbortSignal) {
		const worker = async () => {
			for (let job; !signal.aborted && (job = this.#nextJob());) {
				const [name, k] = job;
				const res = await fetch(`${dirs[name]}/${k}.mp3`, { signal });
				if (!res.ok) throw new Error(`${res.url}: ${res.status} ${res.statusText}`);
				this.#mp3s[k].set(name, await res.arrayBuffer());
				this.loaded[k] = this.#mp3s[k].size === this.#names.length;
				this.#decode(this.#from);
			}
		};
		try {
			await Promise.all(Array.from({ length: FETCHES }, worker));
		} catch (e) {
			this.#fail(e, signal);
		}
	}

	#fail(e: unknown, signal?: AbortSignal) {
		if (!signal?.aborted && !this.error) this.error = String((e as Error).message ?? e);
	}

	/** Drops the decoded chunks outside the window from chunk `from` on and decodes the missing ones. */
	#decode(from = this.#chunkAt(this.now())) {
		if (this.error) return;
		this.#from = from;
		const to = Math.min(from + AHEAD, this.loaded.length - 1);
		this.#chunks.forEach((m, k) => {
			if (k < from || k > to) m.clear();
		});
		for (let k = from; k <= to; k++) {
			for (const [name, mp3] of this.#mp3s[k]) {
				if (this.#decodes >= DECODES) return;
				if (this.#chunks[k].has(name) || this.#decoding[k].has(name)) continue;
				this.#decoding[k].add(name);
				this.#decodes++;
				// decodeAudioData detaches its argument, so keep the original for later decodes.
				this.#ctx
					.decodeAudioData(mp3.slice(0))
					.then((decoded) => this.#add(name, k, decoded))
					.catch((e) => this.#fail(e))
					.finally(() => {
						this.#decoding[k].delete(name);
						this.#decodes--;
						this.#decode(this.#from);
					});
			}
		}
	}

	/** The next chunk to fetch: the first missing one from the playhead on, then from the start. */
	#nextJob(): [string, number] | undefined {
		if (this.error) return;
		const count = this.loaded.length,
			from = this.#chunkAt(this.now());
		for (let i = 0; i < count; i++) {
			const k = (from + i) % count;
			const name = this.#names.find((n) => !this.#requested[k].has(n));
			if (name) {
				this.#requested[k].add(name);
				return [name, k];
			}
		}
	}

	/** Stores a decoded chunk without the padding around it, and schedules it if it is due. */
	#add(name: string, k: number, decoded: AudioBuffer) {
		if (k < this.#from || k > this.#from + AHEAD) return; // the playhead moved on while decoding
		const { length, chunk, pad, rate } = this.#info;
		const start = k * chunk,
			len = Math.min(chunk, length - start),
			lead = k > 0 ? pad : 0;
		const expected = Math.min(length, start + chunk + pad) - (start - lead);
		if (decoded.length !== expected)
			throw new Error(`chunk ${k} of ${name}: ${decoded.length} samples, expected ${expected}`);
		const buffer = new AudioBuffer({
			numberOfChannels: decoded.numberOfChannels,
			length: len,
			sampleRate: rate
		});
		for (let c = 0; c < decoded.numberOfChannels; c++)
			buffer.copyToChannel(decoded.getChannelData(c).subarray(lead, lead + len), c);
		this.#chunks[k].set(name, buffer);
		if (!this.#decoded(k)) return;
		if (this.waiting && k === this.#chunkAt(this.#offset)) this.#start();
		else if (this.playing && !this.waiting && k === this.#next) this.#schedule();
	}

	#decoded(k: number) {
		return this.#chunks[k].size === this.#names.length;
	}

	#chunkAt(t: number) {
		return Math.min(Math.floor(t / this.chunkSeconds), this.loaded.length - 1);
	}

	now() {
		if (!this.playing || this.waiting) return this.#offset;
		const latency = (this.#ctx.baseLatency || 0) + (this.#ctx.outputLatency || 0);
		return Math.max(this.#offset, this.#ctx.currentTime - this.#startCtx - latency);
	}

	play() {
		if (this.playing) return;
		if (this.#offset >= this.duration) this.#offset = 0;
		this.#ctx.resume();
		this.playing = true;
		this.#start();
	}

	/** Starts a run of source nodes at #offset, or waits until its chunk has arrived. */
	#start() {
		const k = this.#chunkAt(this.#offset);
		this.waiting = this.#held || !this.#decoded(k);
		this.#decode(k);
		if (this.waiting) return;
		const rate = this.#info.rate;
		this.#startCtx = Math.ceil((this.#ctx.currentTime + 0.05) * rate) / rate - this.#offset;
		this.#next = k;
		this.#schedule();
	}

	/** Schedules the consecutive chunks that have arrived, starting at #next. */
	#schedule() {
		const run = this.#run;
		for (; this.#next < this.loaded.length && this.#decoded(this.#next); this.#next++) {
			const k = this.#next,
				t0 = k * this.chunkSeconds,
				begin = Math.max(t0, this.#offset),
				when = this.#startCtx + begin;
			// Too late to continue seamlessly; the end of the previous chunk restarts playback.
			if (k > this.#chunkAt(this.#offset) && when < this.#ctx.currentTime + 0.02) break;
			for (const [name, buffer] of this.#chunks[k]) {
				const src = new AudioBufferSourceNode(this.#ctx, { buffer });
				src.connect(this.#gains.get(name)!);
				src.start(when, begin - t0);
				this.#sources.push(src);
			}
			const last = this.#sources[this.#sources.length - 1];
			last.onended = () => {
				if (run === this.#run) this.#decode(k + 1);
				if (run !== this.#run || k !== this.#next - 1 || this.#next >= this.loaded.length) return;
				// The audio ran out before the next chunk arrived.
				this.#stop();
				this.#offset = this.#next * this.chunkSeconds;
				this.#start();
			};
		}
	}

	#stop() {
		this.#run++;
		for (const s of this.#sources) s.stop();
		this.#sources = [];
	}

	get held() {
		return this.#held;
	}

	/** Stops the sound until release(), but stays playing. */
	hold() {
		this.#held = true;
		if (!this.playing) return;
		this.#offset = this.now();
		this.#stop();
		this.waiting = true;
	}

	release() {
		this.#held = false;
		if (this.playing && this.waiting) this.#start();
	}

	pause() {
		if (!this.playing) return;
		this.#offset = this.now();
		this.#stop();
		this.playing = this.waiting = false;
	}

	seek(t: number) {
		const wasPlaying = this.playing;
		this.pause();
		const rate = this.#info.rate;
		this.#offset = Math.round(Math.min(Math.max(0, t), this.duration) * rate) / rate;
		if (wasPlaying) this.play();
		else this.#decode();
	}

	setGain(name: string, value: number) {
		this.#gains.get(name)?.gain.setTargetAtTime(value, this.#ctx.currentTime, 0.05);
	}

	close() {
		this.pause();
		this.#ctx.close();
	}
}

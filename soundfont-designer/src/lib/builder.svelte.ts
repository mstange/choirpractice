import type { BuildReply, BuildRequest, Built } from './build-worker.ts';
import type { Patch } from './patch.ts';

/**
 * Builds patches in a worker, one at a time: a patch asked for while another builds waits, and
 * replaces any patch that was waiting before it, so that dragging a slider builds only the latest.
 */
export class Builder {
	built = $state.raw<Built | null>(null);
	error = $state('');
	#worker = new Worker(new URL('./build-worker.ts', import.meta.url), { type: 'module' });
	#waiting: Omit<BuildRequest, 'id'> | null = null;
	#busy = false;
	#id = 0;
	/** The export that waits for its file. */
	#exports = new Map<number, (file: ArrayBuffer) => void>();

	constructor() {
		this.#worker.onmessage = ({ data }: MessageEvent<BuildReply>) => {
			const done = this.#exports.get(data.id);
			if ('error' in data) this.error = data.error;
			else if (done) done(data.built.file);
			else {
				this.error = '';
				this.built = data.built;
			}
			this.#exports.delete(data.id);
			this.#busy = false;
			this.#next();
		};
	}

	/** Builds `patch` for playing, with a preview of `key`. */
	build(patch: Patch, program: number, key: number) {
		this.#waiting = { patch, program, key };
		this.#next();
	}

	/** The SF2 file of `patch`, with its preset at `program`. */
	export(patch: Patch, program: number): Promise<ArrayBuffer> {
		const id = this.#id++;
		this.#worker.postMessage({ id, patch, program, key: 60 } satisfies BuildRequest);
		return new Promise((resolve) => this.#exports.set(id, resolve));
	}

	#next() {
		if (this.#busy || !this.#waiting) return;
		this.#busy = true;
		this.#worker.postMessage({ id: this.#id++, ...this.#waiting } satisfies BuildRequest);
		this.#waiting = null;
	}
}

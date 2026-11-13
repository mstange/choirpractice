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
	#waiting: { patch: Patch; program: number; key: number } | null = null;
	#busy = false;
	#id = 0;
	/** The exports that wait for their files, which don't wait for builds, nor builds for them. */
	#exports = new Map<
		number,
		{ resolve: (file: ArrayBuffer) => void; reject: (e: Error) => void }
	>();

	constructor() {
		this.#worker.onmessage = ({ data }: MessageEvent<BuildReply>) => {
			const exported = this.#exports.get(data.id);
			if (exported) {
				this.#exports.delete(data.id);
				if ('exported' in data) exported.resolve(data.exported);
				else exported.reject(new Error('error' in data ? data.error : 'not exported'));
				return;
			}
			if ('error' in data) this.error = data.error;
			else if ('built' in data) {
				this.error = '';
				this.built = data.built;
			}
			this.#busy = false;
			this.#next();
		};
	}

	/** Builds `patch` for playing, with a preview of `key`. */
	build(patch: Patch, program: number, key: number) {
		this.#waiting = { patch, program, key };
		this.#next();
	}

	/** The SF3 file of `patch`, with its preset at `program`. */
	export(patch: Patch, program: number): Promise<ArrayBuffer> {
		const id = this.#id++;
		this.#worker.postMessage({ id, patch, program, export: true } satisfies BuildRequest);
		return new Promise((resolve, reject) => this.#exports.set(id, { resolve, reject }));
	}

	#next() {
		if (this.#busy || !this.#waiting) return;
		this.#busy = true;
		this.#worker.postMessage({ id: this.#id++, ...this.#waiting } satisfies BuildRequest);
		this.#waiting = null;
	}
}

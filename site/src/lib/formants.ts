// A voice's vocal tract moving from one vowel to another: a filter on the voice's samples.

/** Formant frequencies and bandwidths in Hz. */
export type Formants = { freq: number[]; bw: number[] };

/**
 * The formants of an instrument's presets per vowel: per bank (see vowels.ts), the formants on each
 * of `keys`, which hold in between along the logarithm of the frequency. The soundfont designer
 * writes it beside the instrument's soundfont file.
 */
export type FormantTable = { keys: number[]; banks: (Formants[] | null)[] };

/** Seconds after a slide in which the filter's own ringing dies away. */
const TAIL = 0.03;
/** Seconds over which a slide measures the power that it keeps. */
const POWER_TIME = 0.02;

/** The formants of `bank` of `table` on `key`, if it has them. */
export function formantsAt(table: FormantTable, bank: number, key: number): Formants | undefined {
	const registers = table.banks[bank],
		keys = table.keys;
	if (!registers) return undefined;
	let a = 0;
	while (a < keys.length - 1 && key >= keys[a + 1]) a++;
	const b = Math.min(a + 1, keys.length - 1),
		t = a === b ? 0 : Math.max(0, Math.min(1, (key - keys[a]) / (keys[b] - keys[a]))),
		mix = (x: number, y: number) => x ** (1 - t) * y ** t;
	return {
		freq: registers[a].freq.map((f, i) => mix(f, registers[b].freq[i])),
		bw: registers[a].bw.map((w, i) => mix(w, registers[b].bw[i]))
	};
}

/**
 * The formants of a voice that plays the preset of `to` moving from `from` to `to` over `seconds`:
 * a cascade of resonators at the moving formants against one at those of `to`, each 1 at 0 Hz,
 * as the soundfont designer's vowels are (its vowel.ts). Once they have arrived, poles and zeros
 * cancel, and the filter passes the voice unchanged. The designer makes every preset as loud, so
 * the slide keeps the voice's power: it divides the filter's output by its gain in power, as
 * measured over the last POWER_TIME seconds.
 */
export class Slide {
	#from: Formants;
	#to: Formants;
	#seconds: number;
	#rate: number;
	#elapsed = 0;
	/** Per resonator, its last two inputs and outputs. */
	#state: Float64Array;
	/** The power of the filter's input and output, averaged, and the gain that keeps it. */
	#in = 0;
	#out = 0;
	#gain = 1;

	constructor(from: Formants, to: Formants, seconds: number, sampleRate: number) {
		this.#from = from;
		this.#to = to;
		this.#seconds = seconds;
		this.#rate = sampleRate;
		this.#state = new Float64Array(4 * to.freq.length);
	}

	/** Filters the next `n` samples of `buf` in place; false once the slide has died away. */
	run(buf: Float32Array, n: number) {
		let pin = 0;
		for (let i = 0; i < n; i++) pin += buf[i] * buf[i];
		const x = Math.min(1, this.#elapsed / this.#seconds),
			e = (1 - Math.cos(Math.PI * x)) / 2,
			{ freq, bw } = this.#to,
			s = this.#state,
			rate = this.#rate;
		for (let k = 0; k < freq.length; k++) {
			const f = this.#from.freq[k] ** (1 - e) * freq[k] ** e,
				w = this.#from.bw[k] ** (1 - e) * bw[k] ** e,
				rp = Math.exp((-Math.PI * w) / rate),
				rz = Math.exp((-Math.PI * bw[k]) / rate),
				a1 = -2 * rp * Math.cos((2 * Math.PI * f) / rate),
				a2 = rp * rp,
				b1 = -2 * rz * Math.cos((2 * Math.PI * freq[k]) / rate),
				b2 = rz * rz,
				g = (1 + a1 + a2) / (1 + b1 + b2);
			let x1 = s[4 * k],
				x2 = s[4 * k + 1],
				y1 = s[4 * k + 2],
				y2 = s[4 * k + 3];
			for (let i = 0; i < n; i++) {
				const x0 = buf[i],
					y0 = g * (x0 + b1 * x1 + b2 * x2) - a1 * y1 - a2 * y2;
				x2 = x1;
				x1 = x0;
				y2 = y1;
				y1 = y0;
				buf[i] = y0;
			}
			s[4 * k] = x1;
			s[4 * k + 1] = x2;
			s[4 * k + 2] = y1;
			s[4 * k + 3] = y2;
		}
		let pout = 0;
		for (let i = 0; i < n; i++) pout += buf[i] * buf[i];
		// The first block sets the averages; the gain moves to its new value across the block.
		const k = this.#elapsed ? 1 - Math.exp(-n / (POWER_TIME * rate)) : 1;
		this.#in += (pin - this.#in) * k;
		this.#out += (pout - this.#out) * k;
		const gain = this.#out > 0 ? Math.sqrt(this.#in / this.#out) : 1,
			step = (gain - this.#gain) / n;
		for (let i = 0; i < n; i++) buf[i] *= this.#gain + step * (i + 1);
		this.#gain = gain;
		this.#elapsed += n / rate;
		return this.#elapsed < this.#seconds + TAIL;
	}
}

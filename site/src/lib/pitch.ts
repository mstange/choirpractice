// Pitch detection with the McLeod pitch method: "A Smarter Way to Find Pitch", McLeod & Wyvill,
// ICMC 2005.

const MIN_FREQ = 55; // A1, below any bass part
const MAX_FREQ = 1400; // above any soprano part
const PEAK_THRESHOLD = 0.9; // pick the first key maximum within this fraction of the highest one
const MIN_CLARITY = 0.8; // NSDF peak height below which a frame counts as unpitched
const MIN_RMS = 0.003; // about -50 dBFS

let nsdf = new Float32Array(0);

/** The MIDI pitch (fractional) of a window of samples, or null if it has no clear pitch. */
export function detectPitch(x: Float32Array, rate: number): number | null {
	const n = x.length;
	const maxLag = Math.min(Math.ceil(rate / MIN_FREQ), n >> 1),
		minLag = Math.floor(rate / MAX_FREQ);
	if (nsdf.length < maxLag + 2) nsdf = new Float32Array(maxLag + 2);

	// Normalized square difference function: 2·r(τ) / m(τ), with r the autocorrelation and m the
	// energy of both overlapping parts.
	let m = 0;
	for (let j = 0; j < n; j++) m += x[j] * x[j];
	if (Math.sqrt(m / n) < MIN_RMS) return null;
	m *= 2;
	for (let tau = 0; tau <= maxLag + 1; tau++) {
		let r = 0;
		for (let j = 0, end = n - tau; j < end; j++) r += x[j] * x[j + tau];
		nsdf[tau] = m > 0 ? (2 * r) / m : 0;
		m -= x[tau] * x[tau] + x[n - 1 - tau] * x[n - 1 - tau];
	}

	// Key maxima: the highest point between each positive-going zero crossing and the next
	// negative-going one. Only lags from minLag on can be picked.
	const peaks: number[] = [];
	let tau = 1;
	while (tau <= maxLag && nsdf[tau] > 0) tau++;
	for (; tau <= maxLag; ) {
		while (tau <= maxLag && nsdf[tau] <= 0) tau++;
		let best = -1;
		for (; tau <= maxLag && nsdf[tau] > 0; tau++)
			if (tau >= minLag && (best < 0 || nsdf[tau] > nsdf[best])) best = tau;
		if (best > 0) peaks.push(best);
	}
	if (!peaks.length) return null;
	const highest = Math.max(...peaks.map((p) => nsdf[p]));
	const peak = peaks.find((p) => nsdf[p] >= PEAK_THRESHOLD * highest)!;

	// Parabolic interpolation around the peak.
	const [a, b, c] = [nsdf[peak - 1], nsdf[peak], nsdf[peak + 1]];
	const denom = a - 2 * b + c;
	const shift = denom < 0 ? (0.5 * (a - c)) / denom : 0;
	const clarity = b - 0.25 * (a - c) * shift;
	if (clarity < MIN_CLARITY) return null;
	return 69 + 12 * Math.log2(rate / (peak + shift) / 440);
}

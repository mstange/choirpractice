// Makes a sound bank of one preset from a Patch: per zone of keys, a looped sample of the tone and
// a one-shot sample of the attack, synthesized for the zone's middle key.
import {
	BasicInstrument,
	BasicPreset,
	BasicSample,
	BasicSoundBank,
	GeneratorTypes as G,
	Modulator,
	ModulatorControllerSources,
	ModulatorCurveTypes,
	ModulatorSource,
	SampleTypes,
	type BasicZone
} from 'spessasynth_core';
import { eqCurve, filter, ifft, keyFreq, random } from './dsp.ts';
import { formantBands, type Patch } from './patch.ts';

/** The lowest and highest key that get a sample; the outer zones reach the ends of the keyboard. */
export const LOW_KEY = 33,
	HIGH_KEY = 96;
/**
 * The RMS that a tone at level 0 dB has at full dynamics. It puts the default patch at about the
 * loudness of MS Basic's Choir Aahs, see scripts/test-bank.ts.
 */
const REF = 0.27;
/** Samples are stored at this peak; the zone's attenuation brings them to their level. */
const PEAK = 0.9;
/** Harmonics stay below this fraction of the sample rate, so that playing a zone's highest key
 * with vibrato doesn't alias. */
const NYQUIST = 0.45;

export type Zone = { root: number; min: number; max: number };

/** The zones of keys, each with the key that its samples are made for. */
export function zones(spacing: number): Zone[] {
	const list: Zone[] = [];
	for (let root = LOW_KEY; root < HIGH_KEY + spacing; root += spacing)
		list.push({ root, min: root - Math.floor(spacing / 2), max: root + Math.ceil(spacing / 2) - 1 });
	list[0].min = 0;
	list[list.length - 1].max = 127;
	return list;
}

/**
 * The harmonics of the tone at fundamental `f0`: their frequency and amplitude. Every key is as
 * loud at full dynamics: the harmonics have a total power of 1 after the EQ, the formants and the
 * low-pass filter (which the synthesizer applies), so that these change the timbre and the level
 * the loudness.
 */
export function toneHarmonics(p: Patch, f0: number, sampleRate: number) {
	const { tilt, even, harmonics, maxHarmonic } = p.tone;
	const count = Math.min(maxHarmonic, Math.floor((NYQUIST * sampleRate) / f0));
	const eq = eqCurve([...p.eq, ...formantBands(p.formant)]),
		lp = lowpass(p, f0);
	const list = Array.from({ length: count }, (_, i) => {
		const freq = (i + 1) * f0;
		const db = tilt * Math.log2(i + 1) + (i % 2 ? even : 0) + (harmonics[i] ?? 0) + eq(freq);
		return { freq, amp: 10 ** (db / 20) };
	});
	const norm = Math.sqrt(list.reduce((s, h) => s + (h.amp * lp(h.freq)) ** 2, 0));
	for (const h of list) h.amp /= norm;
	return list;
}

/** The gain of the tone's low-pass filter at full dynamics, for a zone at `f0`. */
export function lowpass(p: Patch, f0: number) {
	if (p.filter.harmonic >= 64) return () => 1;
	const fc = f0 * p.filter.harmonic,
		q = Math.SQRT1_2 * 10 ** (p.filter.q / 20);
	return (f: number) => 1 / Math.sqrt((1 - (f / fc) ** 2) ** 2 + (f / (fc * q)) ** 2);
}

/** The band of the breath noise, a gentle band-pass: its gain at `f`. */
const noiseShape = (f: number, low: number, high: number) =>
	1 / Math.sqrt((1 + (low / f) ** 4) * (1 + (f / high) ** 4));

/**
 * The tone's sample for `key`: a loop of a power-of-two length, built as a spectrum and turned
 * into a signal with an inverse FFT, so that every partial and the noise repeat exactly. The
 * partials fall on the FFT's bins, so the fundamental is off by up to half a bin; `correction`
 * is the pitch correction in cents that makes up for it.
 */
export function toneSample(p: Patch, key: number) {
	const sr = p.output.sampleRate,
		n = 2 ** Math.round(Math.log2(p.output.loop * sr)),
		bin = sr / n;
	const rand = random(p.output.seed * 1000 + key);
	const f0 = keyFreq(key),
		f = Math.max(1, Math.round(f0 / bin)) * bin;
	const re = new Float64Array(n),
		im = new Float64Array(n);
	const add = (k: number, amp: number) => {
		if (k <= 0 || k >= n / 2) return;
		const phase = 2 * Math.PI * rand();
		re[k] += amp * Math.cos(phase);
		im[k] += amp * Math.sin(phase);
	};
	const { voices, detune, noise, noiseLow, noiseHigh } = p.tone;
	const harmonics = toneHarmonics(p, f, sr),
		lp = lowpass(p, f);
	for (let v = 0; v < voices; v++) {
		const ratio = 2 ** ((voices === 1 ? 0 : detune * (v / (voices - 1) - 0.5)) / 1200);
		for (const h of harmonics) add(Math.round((h.freq * ratio) / bin), h.amp / Math.sqrt(voices));
	}
	if (noise > -90) {
		// A power of 10^(noise/10) against the harmonics' 1, as they come out of the filter.
		const kmax = Math.floor((NYQUIST * sr) / bin),
			eq = eqCurve([...p.eq, ...formantBands(p.formant)]),
			amps = new Float64Array(kmax);
		let power = 0;
		for (let k = 1; k < kmax; k++) {
			const shape = noiseShape(k * bin, noiseLow, noiseHigh);
			if (shape < 1e-3) continue;
			amps[k] = shape * 10 ** (eq(k * bin) / 20);
			power += (amps[k] * lp(k * bin)) ** 2;
		}
		const scale = Math.sqrt(10 ** (noise / 10) / power);
		for (let k = 1; k < kmax; k++) if (amps[k]) add(k, scale * amps[k]);
	}
	ifft(re, im);
	return { data: Float32Array.from(re), correction: Math.round(1200 * Math.log2(f0 / f)) };
}

/**
 * The attack's sample for `key`: decaying partials, each higher one decaying faster, and a burst
 * of band-passed noise.
 */
export function attackSample(p: Patch, key: number) {
	const { decay, damping, tilt, inharmonicity, noise, noiseFreq, noiseDecay } = p.attack;
	const sr = p.output.sampleRate,
		f0 = keyFreq(key),
		b = inharmonicity * 1e-3,
		tau = decay / 1000;
	const length = Math.ceil(sr * Math.min(2, 7 * Math.max(tau, noiseDecay / 1000) + 0.01));
	const x = new Float32Array(length);
	const partials: { w: number; r: number; amp: number; len: number }[] = [],
		eq = eqCurve(p.eq);
	for (let h = 1; h <= 64; h++) {
		const freq = h * f0 * Math.sqrt(1 + b * h * h);
		if (freq > NYQUIST * sr) break;
		const t = tau / (1 + damping * (h - 1));
		partials.push({
			w: (2 * Math.PI * freq) / sr,
			r: Math.exp(-1 / (t * sr)),
			amp: 10 ** ((tilt * Math.log2(h) + eq(freq)) / 20),
			// Until it has decayed by 80 dB.
			len: Math.min(length, Math.ceil(t * sr * Math.log(1e4)))
		});
	}
	// A total power of 1, as with the tone.
	const norm = Math.sqrt(partials.reduce((s, q) => s + q.amp ** 2, 0));
	for (const { w, r, amp, len } of partials) {
		// A decaying sine by its recurrence: y[n] = 2r·cos(w)·y[n-1] - r²·y[n-2].
		const c = 2 * r * Math.cos(w),
			r2 = r * r,
			a = amp / norm;
		let y2 = 0,
			y1 = a * r * Math.sin(w);
		x[1] += y1;
		for (let i = 2; i < len; i++) {
			const y = c * y1 - r2 * y2;
			x[i] += y;
			y2 = y1;
			y1 = y;
		}
	}
	if (noise > -90) {
		const rand = random(p.output.seed * 1000 + 500 + key),
			burst = new Float32Array(length);
		for (let i = 0; i < length; i++) burst[i] = rand() * 2 - 1;
		bandpass(burst, noiseFreq, 0.8, sr);
		let power = 0;
		for (const v of burst) power += v * v;
		const scale = Math.sqrt((10 ** (noise / 10) * length) / power),
			// A 1 ms fade-in keeps the burst from clicking.
			fade = sr / 1000;
		for (let i = 0; i < length; i++)
			burst[i] *= scale * Math.exp(-i / ((noiseDecay / 1000) * sr)) * Math.min(1, i / fade);
		filter(burst, p.eq, sr);
		for (let i = 0; i < length; i++) x[i] += burst[i];
	}
	// The last 10 ms fade out.
	const fade = Math.min(length, Math.round(sr / 100));
	for (let i = 0; i < fade; i++) x[length - 1 - i] *= i / fade;
	return x;
}

/** An RBJ band-pass with 0 dB at its center, in place. */
function bandpass(x: Float32Array, freq: number, q: number, sampleRate: number) {
	const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate,
		alpha = Math.sin(w) / (2 * q),
		a0 = 1 + alpha;
	const b0 = alpha / a0,
		a1 = (-2 * Math.cos(w)) / a0,
		a2 = (1 - alpha) / a0;
	let x1 = 0,
		x2 = 0,
		y1 = 0,
		y2 = 0;
	for (let i = 0; i < x.length; i++) {
		const y = b0 * x[i] - b0 * x2 - a1 * y1 - a2 * y2;
		x2 = x1;
		x1 = x[i];
		y2 = y1;
		y1 = x[i] = y;
	}
}

/** Timecents of a time in seconds, for the envelope and LFO generators. */
const timecents = (s: number) => Math.max(-12000, Math.round(1200 * Math.log2(Math.max(s, 0.001))));
/** Absolute cents of a frequency, for filters and LFOs. */
const absCents = (hz: number) => Math.round(1200 * Math.log2(hz / 8.176));

const velocity = (curve: number) =>
	new ModulatorSource(ModulatorControllerSources.noteOnVelocity, curve, false, false, true);
const breath = (curve: number) => new ModulatorSource(2, curve, true, false, true);
/**
 * A modulator that lowers its destination by `amount` at the source's minimum, and not at all at
 * its maximum. With the SF2 default's own source and destination it replaces the default.
 */
const lower = (source: ModulatorSource, destination: number, amount: number) =>
	new Modulator(source, new ModulatorSource(), destination as never, amount, 0);

/** Sets the volume and brightness modulators of a layer that follows `source`. */
function dynamics(zone: BasicZone, source: 'cc2' | 'velocity', range: number, brightness: number) {
	const { concave, linear } = ModulatorCurveTypes;
	// The default velocity-to-volume modulator, at 0 if the layer follows CC2 instead.
	zone.modulators.push(
		lower(velocity(concave), G.initialAttenuation, source === 'velocity' ? range * 10 : 0)
	);
	const from = source === 'velocity' ? velocity : breath;
	if (source === 'cc2') zone.modulators.push(lower(from(concave), G.initialAttenuation, range * 10));
	if (brightness) zone.modulators.push(lower(from(linear), G.initialFilterFc, -brightness));
}

export type Built = {
	bank: BasicSoundBank;
	/** The root keys of the zones whose level is beyond what a sample at full scale can reach. */
	clipped: number[];
};

/** The sound bank of a patch, with one preset of the given General MIDI program. */
export function buildBank(p: Patch, program: number): Built {
	const bank = new BasicSoundBank();
	bank.soundBankInfo = { ...bank.soundBankInfo, name: p.name, software: 'soundfont-designer' };
	const sr = p.output.sampleRate,
		clipped: number[] = [];

	/** A sample stored at PEAK, and the attenuation (in SF2 units) that plays it as `gain` × `data`. */
	const store = (name: string, data: Float32Array, root: number, gain: number, loop: boolean) => {
		let peak = 0;
		for (const v of data) peak = Math.max(peak, Math.abs(v));
		const scale = PEAK / (peak || 1);
		for (let i = 0; i < data.length; i++) data[i] *= scale;
		const sample = new BasicSample(
			name,
			sr,
			root,
			0,
			SampleTypes.monoSample,
			0,
			loop ? data.length : 0
		);
		sample.setAudioData(data, sr);
		bank.addSamples(sample);
		const db = 20 * Math.log10(gain / scale);
		if (db > 0.05 && !clipped.includes(root)) clipped.push(root);
		// spessasynth, like E-mu's hardware, applies 0.4 of initialAttenuation.
		return { sample, attenuation: Math.round(Math.max(0, -db) * 25) };
	};

	const tone = new BasicInstrument();
	tone.name = `${p.name}: Tone`;
	const attack = new BasicInstrument();
	attack.name = `${p.name}: Attack`;
	const toneGain = REF * 10 ** (p.tone.level / 20),
		attackGain = REF * 10 ** ((p.tone.level + p.attack.level) / 20);
	for (const { root, min, max } of zones(p.output.spacing)) {
		const t = toneSample(p, root);
		const ts = store(`tone ${root}`, t.data, root, toneGain, true);
		ts.sample.pitchCorrection = t.correction;
		const tz = tone.createZone(ts.sample);
		tz.keyRange = { min, max };
		tz.setGenerator(G.initialAttenuation, ts.attenuation);
		if (p.filter.harmonic < 64)
			tz.setGenerator(G.initialFilterFc, Math.min(13500, absCents(keyFreq(root) * p.filter.harmonic)));
		if (p.attack.enabled) {
			const as = store(`attack ${root}`, attackSample(p, root), root, attackGain, false);
			const az = attack.createZone(as.sample);
			az.keyRange = { min, max };
			az.setGenerator(G.initialAttenuation, as.attenuation);
		}
	}

	const { env, onset, vibrato, tremolo } = p;
	const g = tone.globalZone;
	g.setGenerator(G.sampleModes, 1);
	g.setGenerator(G.attackVolEnv, timecents(env.attack / 1000));
	g.setGenerator(G.holdVolEnv, timecents(env.hold / 1000));
	g.setGenerator(G.decayVolEnv, timecents(env.decay / 1000));
	g.setGenerator(G.sustainVolEnv, Math.min(1440, Math.max(0, Math.round(-env.sustain * 10))));
	g.setGenerator(G.releaseVolEnv, timecents(env.release / 1000));
	if (onset.bright || onset.scoop) {
		g.setGenerator(G.attackModEnv, -12000);
		g.setGenerator(G.decayModEnv, timecents(onset.time / 1000));
		g.setGenerator(G.sustainModEnv, 1000);
		g.setGenerator(G.modEnvToFilterFc, Math.round(onset.bright));
		g.setGenerator(G.modEnvToPitch, -Math.round(onset.scoop));
	}
	if (vibrato.depth) {
		g.setGenerator(G.freqVibLFO, absCents(vibrato.rate));
		g.setGenerator(G.delayVibLFO, timecents(vibrato.delay / 1000));
		g.setGenerator(G.vibLfoToPitch, Math.round(vibrato.depth));
	}
	if (tremolo.depth) {
		g.setGenerator(G.freqModLFO, absCents(tremolo.rate));
		g.setGenerator(G.delayModLFO, timecents(vibrato.delay / 1000));
		g.setGenerator(G.modLfoToVolume, Math.round(tremolo.depth * 10));
	}
	if (p.filter.q) g.setGenerator(G.initialFilterQ, Math.round(p.filter.q * 10));
	dynamics(g, p.dynamics.source, p.dynamics.range, p.dynamics.brightness);

	const a = attack.globalZone;
	a.setGenerator(G.releaseVolEnv, timecents(env.release / 1000));
	dynamics(a, 'velocity', p.attack.velRange, p.dynamics.brightness);

	for (const zone of [g, a]) {
		if (p.output.reverb) zone.setGenerator(G.reverbEffectsSend, Math.round(p.output.reverb * 10));
		if (p.output.chorus) zone.setGenerator(G.chorusEffectsSend, Math.round(p.output.chorus * 10));
	}

	const preset = new BasicPreset(bank);
	preset.name = p.name;
	preset.program = program;
	preset.createZone(tone);
	bank.addInstruments(tone);
	if (p.attack.enabled) {
		preset.createZone(attack);
		bank.addInstruments(attack);
	}
	bank.addPresets(preset);
	bank.flush();
	return { bank, clipped };
}

<script lang="ts">
	import type { DesignerSynth } from '../designer-synth.ts';
	import type { Patch, Vowel, VowelFormants } from '../patch.ts';
	import { Recorder, wav } from '../recorder.ts';
	import { harmonics } from '../sung.ts';
	import type { SungReply, SungRequest } from '../sung-worker.ts';
	import { detectPitch } from '../../../../site/src/lib/pitch.ts';
	import { sungAh, TABLE_VOWELS, VOWELS, vowelFormants } from '../vowel.ts';
	import { VOWELS as LYRIC_VOWELS, type Ipa } from '../../../../site/src/lib/vowels.ts';
	import { prepare } from './canvas.ts';
	import Slider from './Slider.svelte';

	let {
		patch,
		synth,
		singVowels = $bindable()
	}: { patch: Patch; synth: DesignerSynth | null; singVowels: boolean } = $props();

	/**
	 * The fit needs the harmonics to sample the spectrum densely: frequency bands of an eighth of an
	 * octave from `LOWEST` Hz up to the highest harmonic measured, each with harmonics in it for
	 * `NEED` seconds. A held note fills the bands wider than its pitch, above about 1 kHz; the
	 * narrower bands below fill as the pitch moves, by a few semitones near F1. The bands below the
	 * lowest pitch sung can't fill, and aren't needed. The recording stops once every band needed
	 * is full, or after `LONGEST` seconds.
	 */
	const LOWEST = 250,
		BANDS = 30,
		NEED = 0.2,
		LONGEST = 30;
	const bandOf = (f: number) => Math.floor(8 * Math.log2(f / LOWEST)),
		bandFreq = (i: number) => LOWEST * 2 ** (i / 8);
	/** The fewest frames with a clear pitch that a fit is made from, and the most error trusted. */
	const MIN_FRAMES = 100,
		MAX_ERROR = 6;

	const nameOf = (ipa: Ipa) => LYRIC_VOWELS.find((v) => v.ipa === ipa)!.name;
	/** The table's vowels by the name of the choir app's vowel that they are. */
	const tableName = (v: Vowel) =>
		nameOf(Object.entries(TABLE_VOWELS).find(([, t]) => t === v)![0] as Ipa);

	let busy = $state<Ipa | null>(null),
		phase = $state<'record' | 'fit'>('record'),
		error = $state(''),
		last = $state<{ ipa: Ipa; r: SungReply } | null>(null);
	/** The time since the recording started, the pitch sung, and the seconds of harmonics per band. */
	let now = $state(-1),
		trace = $state.raw<[number, number][]>([]),
		covered = $state.raw<number[]>(Array(BANDS).fill(0));
	/** The first band needed: the lowest above the lowest pitch sung. */
	const firstNeeded = $derived(
		trace.length
			? Math.max(0, Math.ceil(8 * Math.log2(Math.min(...trace.map(([, m]) => hz(m))) / LOWEST)))
			: 0
	);
	const full = $derived(covered.filter((c, i) => i >= firstNeeded && c >= NEED).length);
	/** The latest recording, to download. */
	let recording = $state<{ ipa: Ipa; url: string } | null>(null);
	/** Ends the recording early. */
	let done: (() => void) | null = null;

	const ah = $derived(sungAh(patch));
	/** The sung vowels that were measured against another "ah" than the sung a's. */
	const stale = $derived(
		ah
			? (Object.entries(patch.vowels) as [Ipa, VowelFormants][]).filter(
					([ipa, f]) => ipa !== 'a' && f.measured.length && f.measured[0].join() !== ah.join()
				)
			: []
	);

	const recorder = new Recorder();
	$effect(() => () => recorder.close());

	function fit(x: Float32Array, rate: number) {
		const worker = new Worker(new URL('../sung-worker.ts', import.meta.url), { type: 'module' });
		return new Promise<SungReply>((resolve) => {
			worker.onmessage = ({ data }: MessageEvent<SungReply>) => {
				worker.terminate();
				resolve(data);
			};
			worker.postMessage({ x, rate } satisfies SungRequest, [x.buffer]);
		});
	}

	const ratios = (vowel: number[], ah: number[]) =>
		vowel.map((f, i) => Math.round((f / ah[i]) * 100) / 100);

	/** Records `ipa` and gives it the formants sung, against the sung "ah"; the "ah" is that. */
	async function sing(ipa: Ipa) {
		error = '';
		busy = ipa;
		patch.selected = ipa;
		synth?.pause();
		try {
			await recorder.open();
		} catch (e) {
			error = `No microphone: ${(e as Error).message}`;
			busy = null;
			return;
		}
		trace = [];
		covered = Array(BANDS).fill(0);
		phase = 'record';
		recorder.start();
		const start = performance.now();
		await new Promise<void>((resolve) => {
			let frame = 0,
				before = start;
			done = () => {
				cancelAnimationFrame(frame);
				done = null;
				resolve();
			};
			const follow = (t: number) => {
				now = Math.max(0, (t - start) / 1000);
				const dt = Math.min(0.1, Math.max(0, (t - before) / 1000)),
					input = recorder.latest(),
					p = detectPitch(input, recorder.rate);
				before = t;
				if (p !== null) {
					trace = [...trace, [now, p]];
					const next = covered.slice();
					for (const f of new Set(harmonics(input, recorder.rate, p).freq.map(bandOf)))
						if (f >= 0 && f < BANDS) next[f] += dt;
					covered = next;
				}
				if (now >= LONGEST || (trace.length && full === BANDS - firstNeeded)) done!();
				else frame = requestAnimationFrame(follow);
			};
			frame = requestAnimationFrame(follow);
		});
		const x = recorder.stop();
		now = -1;
		if (recording) URL.revokeObjectURL(recording.url);
		recording = { ipa, url: URL.createObjectURL(wav(x, recorder.rate)) };
		phase = 'fit';
		const r = await fit(x, recorder.rate);
		busy = null;
		if (r.frames < MIN_FRAMES) {
			error = `Only ${r.frames} moments had a clear pitch. Sing louder or nearer the microphone, and try again.`;
			return;
		}
		last = { ipa, r };
		const reference = ipa === 'a' ? r.formants : ah!;
		patch.vowels[ipa] = {
			vowel: 'sung',
			sung: ratios(r.formants, reference),
			measured: [reference, r.formants]
		};
	}

	function remeasure() {
		for (const [ipa, f] of stale)
			patch.vowels[ipa] = {
				...f,
				sung: ratios(f.measured[1], ah!),
				measured: [ah!, f.measured[1]]
			};
	}

	/** What a vowel's sound is: '' for borrowed, a vowel of the table, or 'sung'. */
	const source = (ipa: Ipa) => patch.vowels[ipa]?.vowel ?? TABLE_VOWELS[ipa] ?? '';
	const hasSung = (f: VowelFormants | undefined) =>
		!!f && (f.vowel === 'sung' || f.measured.length > 0 || f.sung.some((x) => x !== 1));
	/** The vowel that `ipa` sings like while it has no sound of its own. */
	const borrowed = (ipa: Ipa) =>
		vowelFormants({ ...patch, vowels: { ...patch.vowels, [ipa]: undefined } }, ipa).from;

	function setSource(ipa: Ipa, value: string) {
		patch.selected = ipa;
		const own = patch.vowels[ipa];
		if (value === '') delete patch.vowels[ipa];
		else if (hasSung(own)) own!.vowel = value as Vowel | 'sung';
		else if (value === TABLE_VOWELS[ipa]) delete patch.vowels[ipa];
		else patch.vowels[ipa] = { vowel: value as Vowel, sung: [1, 1, 1], measured: [] };
	}

	const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
	const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
	const noteName = (m: number) => {
		const key = Math.round(m);
		return `${NOTE_NAMES[key % 12]}${Math.floor(key / 12) - 1}`;
	};

	let canvas: HTMLCanvasElement;
	let width = $state(0);
	$effect(() => {
		void width;
		const { ctx, w, h } = prepare(canvas);
		// The pitch sung over time, above: the time axis grows with the recording, from 8 s, and
		// the pitch axis spans what was sung, at least an octave.
		const pitches = trace.map(([, m]) => m),
			lo = (pitches.length ? Math.min(...pitches) : 45) - 1,
			hi = Math.max(lo + 14, (pitches.length ? Math.max(...pitches) : 0) + 1),
			span = Math.max(8, now, trace.at(-1)?.[0] ?? 0),
			x = (t: number) => (t / span) * w,
			y = (m: number) => h - 30 - ((m - lo) / (hi - lo)) * (h - 36);
		// The frequency bands, below, brighter as they fill, and dark where they aren't needed.
		const band = (i: number) => (i / BANDS) * w;
		covered.forEach((c, i) => {
			ctx.fillStyle =
				i < firstNeeded ? '#1c1f26' : `rgba(240, 180, 41, ${0.12 + 0.6 * Math.min(1, c / NEED)})`;
			ctx.fillRect(band(i), h - 14, band(i + 1) - band(i) - 1, 14);
		});
		ctx.fillStyle = '#6a7080';
		for (const f of [250, 500, 1000, 2000]) {
			const i = 8 * Math.log2(f / LOWEST);
			ctx.fillText(f < 1000 ? `${f} Hz` : `${f / 1000} kHz`, band(i) + 2, h - 17);
		}
		ctx.textAlign = 'right';
		ctx.fillText(`${(bandFreq(BANDS) / 1000).toFixed(1)} kHz`, w - 2, h - 17);
		ctx.textAlign = 'left';
		ctx.strokeStyle = '#2c303a';
		for (let m = Math.ceil(lo / 6) * 6; m <= hi; m += 6) {
			ctx.beginPath();
			ctx.moveTo(0, y(m));
			ctx.lineTo(w, y(m));
			ctx.stroke();
			ctx.fillText(noteName(m), 2, y(m) - 2);
		}
		ctx.fillStyle = '#60d0e0';
		for (const [t, m] of trace) ctx.fillRect(x(t) - 1.5, y(m) - 1.5, 3, 3);
		if (now >= 0) {
			ctx.strokeStyle = '#fff';
			ctx.beginPath();
			ctx.moveTo(x(now), 0);
			ctx.lineTo(x(now), h - 30);
			ctx.stroke();
		}
	});

	const describe = (r: SungReply) =>
		`F1 ${r.formants[0]}, F2 ${r.formants[1]}, F3 ${r.formants[2]} Hz, from ${noteName(r.low)} to ${noteName(r.high)}, ` +
		`${r.error.toFixed(1)} dB from the fit`;
</script>

<p class="hint">
	The choir app sings each syllable on its vowel: "moon" on oo, "night" on ah moving to ih. Each
	vowel below gets its sound from one of three places: <b>built-in</b>, the textbook formants of ah,
	ay, ee, oh or oo (from Csound's formant table); <b>your recording</b>, a vowel that you sang with
	Sing; or <b>same as</b> another vowel, the nearest one that has a sound, until you give it one. The
	selected vowel is the one that the keyboard and the plots play, and that Match fits the contour around.
</p>
<details class="hint">
	<summary>What a vowel is here</summary>
	<p>
		A vowel is a vocal tract's resonances, its formants, against a neutral vowel's: a bass's on E2,
		a tenor's on A#3 and a soprano's on E5, and in between on the keys between. The rest of the
		timbre is the spectral contour, which every vowel shares.
	</p>
	<p>
		A sung vowel is measured against your "ah", so that your voice, the microphone and the room are
		in both and cancel out: it moves the formants of the built-in ah by the ratios of your vowel's
		formants to your "ah"'s. So sing "ah" first, in the ah row, and then the other vowels. The ah
		row then plays your recording, which sounds the same as the built-in ah.
	</p>
</details>
<Slider
	label="Vowel"
	bind:value={patch.vowel.amount}
	min={0}
	max={1}
	step={0.05}
	title="How much of the vowel: 1 is a vocal tract's resonances, 0 none"
/>
<Slider
	label="Formant width"
	bind:value={patch.vowel.width}
	min={0.5}
	max={4}
	step={0.1}
	unit="×"
/>
<label class="choice"
	><input type="checkbox" bind:checked={patch.oneVowel} /> Sing every syllable on the selected vowel.
	The exported file then has one preset.</label
>
<label class="choice"
	><input type="checkbox" bind:checked={singVowels} disabled={patch.oneVowel} /> Play the pieces with
	each syllable on its vowel, as the exported file would. Every change then takes longer to build, because
	each vowel is built.</label
>

<p class="hint">
	Sing: sing the vowel at whatever pitches are comfortable, moving around by a few semitones, in
	slides, steps or anything, until the frequency bands under the plot have lit up, or press Done.
	The low bands need the pitch to move; low pitches light more of them. Use headphones, or nothing
	else playing.
</p>
{#if busy}
	<p class="hint">
		{nameOf(busy)}: {phase === 'record'
			? `${full} of ${BANDS - firstNeeded} frequency bands`
			: 'finding the formants…'}
	</p>
{/if}
<canvas bind:this={canvas} bind:clientWidth={width} style="height: 140px"></canvas>
{#if error}<p class="warn">{error}</p>{/if}
{#if last}
	<p class="hint">
		{nameOf(last.ipa)}: {describe(last.r)}{#if last.r.error > MAX_ERROR}<span class="warn"
				>{' — a poor fit: try again'}</span
			>{/if}.
	</p>
{/if}
{#if recording && !busy}
	<p class="hint">
		<a href={recording.url} download="sung-{nameOf(recording.ipa)}.wav">Download the recording</a>
		of {nameOf(recording.ipa)}
	</p>
{/if}
{#if stale.length}
	<p class="hint">
		{stale.map(([ipa]) => nameOf(ipa)).join(', ')}
		{stale.length === 1 ? 'was' : 'were'} measured against another "ah".
		<button onclick={remeasure}>Measure against this "ah"</button>
	</p>
{/if}

<table class="vowels">
	<tbody>
		{#each LYRIC_VOWELS as v (v.ipa)}
			{@const own = patch.vowels[v.ipa]}
			<tr class:selected={patch.selected === v.ipa}>
				<td>
					<label
						><input type="radio" name="vowel" value={v.ipa} bind:group={patch.selected} />
						{v.name}</label
					>
				</td>
				<td class="dim">/{v.ipa}/ {v.word}</td>
				<td>
					<select
						class:dim={!own}
						value={source(v.ipa)}
						onchange={(e) => setSource(v.ipa, e.currentTarget.value)}
						title={own?.measured.length
							? `Recorded: F1–F3 ${own.measured[1].join(', ')} Hz`
							: undefined}
					>
						{#if !TABLE_VOWELS[v.ipa]}<option value="">same as {nameOf(borrowed(v.ipa))}</option
							>{/if}
						{#each VOWELS as t (t)}<option value={t}>built-in {tableName(t)}</option>{/each}
						{#if hasSung(own)}<option value="sung">your recording</option>{/if}
					</select>
				</td>
				<td>
					{#if busy === v.ipa}
						<button disabled={phase !== 'record'} onclick={() => done?.()}>Done</button>
					{:else}
						<button
							disabled={!!busy || (v.ipa !== 'a' && !ah)}
							title={v.ipa !== 'a' && !ah ? 'Sing "ah" first' : `Sing ${v.name} as in ${v.word}`}
							onclick={() => sing(v.ipa)}>Sing</button
						>
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.warn {
		color: #e8657a;
	}
	.choice {
		display: block;
		margin: 4px 0;
	}
	details p {
		margin: 4px 0;
	}
	summary {
		cursor: pointer;
	}
	.vowels {
		border-collapse: collapse;
		margin-top: 6px;
	}
	.vowels td {
		padding: 1px 6px 1px 0;
		white-space: nowrap;
	}
	.vowels select {
		width: 100%;
	}
	.vowels .selected {
		background: #2c303a;
	}
	.dim {
		color: var(--dim);
	}
</style>

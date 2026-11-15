<script lang="ts">
	import type { DesignerSynth } from '../designer-synth.ts';
	import type { Patch, Vowel, VowelFormants } from '../patch.ts';
	import { Recorder, wav } from '../recorder.ts';
	import { BANDS, bandFreq, LOWEST, NEED, STRETCH } from '../sung.ts';
	import type { Assessment, SungReply, SungRequest } from '../sung-worker.ts';
	import { detectPitch } from '../../../../site/src/lib/pitch.ts';
	import { ownVoices, TABLE_VOWELS, VOICE_FADE, VOWELS, vowelFormants } from '../vowel.ts';
	import { VOICE_TYPES } from '../../../../site/src/lib/voice-types.ts';
	import { VOWELS as LYRIC_VOWELS, type Ipa } from '../../../../site/src/lib/vowels.ts';
	import { prepare } from './canvas.ts';
	import Slider from './Slider.svelte';

	let {
		patch,
		synth,
		singVowels = $bindable()
	}: { patch: Patch; synth: DesignerSynth | null; singVowels: boolean } = $props();

	/**
	 * The recording stops once the frequency bands (`BANDS` in `sung.ts`) have been sung through
	 * twice and the formants hold steady, at Done, or after `LONGEST` seconds.
	 */
	const LONGEST = 60;
	/**
	 * The fewest frames with a clear pitch that a fit is made from, and the largest difference of
	 * a formant between the first and the second time through the bands that counts as the same
	 * vowel: Chimera's slides sung twice differ by up to 2%.
	 */
	const MIN_FRAMES = 100,
		MAX_SPREAD = 0.1;

	const nameOf = (ipa: Ipa) => LYRIC_VOWELS.find((v) => v.ipa === ipa)!.name;
	/** The table's vowels by the name of the choir app's vowel that they are. */
	const tableName = (v: Vowel) =>
		nameOf(Object.entries(TABLE_VOWELS).find(([, t]) => t === v)![0] as Ipa);

	let busy = $state<Ipa | null>(null),
		phase = $state<'record' | 'fit'>('record'),
		error = $state(''),
		last = $state<{ ipa: Ipa; fit: Assessment } | null>(null);
	/** The time since the recording started, the pitch sung, and the fit of what was sung so far. */
	let now = $state(-1),
		trace = $state.raw<[number, number][]>([]),
		progress = $state.raw<SungReply | null>(null);
	/** The seconds of harmonics per band of the time through the bands being sung, and the first needed. */
	const covered = $derived(progress?.fit?.coverage.covered ?? Array(BANDS).fill(0)),
		firstNeeded = $derived(progress?.fit?.coverage.first ?? 0),
		full = $derived(covered.filter((c, i) => i >= firstNeeded && c >= NEED).length);
	/** The latest recording, to download. */
	let recording = $state<{ ipa: Ipa; url: string } | null>(null);
	/** Ends the recording early. */
	let done: (() => void) | null = null;

	/** The vowels being edited: the voice type's own, or those of all voice types. */
	const table = $derived(patch.voice ? (patch.voices[patch.voice] ?? {}) : patch.vowels);
	/** The same, to change, made for the voice type if it has none yet. */
	const editable = () => (patch.voice ? (patch.voices[patch.voice] ??= {}) : patch.vowels);

	/** The "ah" that the vowels being edited are sung against, if it was sung. */
	const ah = $derived(table.a?.measured[0]);
	/** The sung vowels that were measured against another "ah" than the sung a's. */
	const stale = $derived(
		ah
			? (Object.entries(table) as [Ipa, VowelFormants][]).filter(
					([ipa, f]) => ipa !== 'a' && f.measured.length && f.measured[0].join() !== ah.join()
				)
			: []
	);

	const recorder = new Recorder();
	$effect(() => () => recorder.close());

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
		progress = null;
		phase = 'record';
		const worker = new Worker(new URL('../sung-worker.ts', import.meta.url), { type: 'module' });
		const send = (m: SungRequest, transfer: Transferable[] = []) => worker.postMessage(m, transfer);
		let finished: (r: SungReply) => void;
		const final = new Promise<SungReply>((resolve) => (finished = resolve));
		worker.onmessage = ({ data }: MessageEvent<SungReply>) => {
			progress = data;
			if (data.final) finished(data);
			else if (data.fit?.time === 3 && data.steady) done?.();
		};
		send({ rate: recorder.rate });
		recorder.start();
		const start = performance.now();
		await new Promise<void>((resolve) => {
			let frame = 0;
			done = () => {
				cancelAnimationFrame(frame);
				done = null;
				resolve();
			};
			const follow = (t: number) => {
				now = Math.max(0, (t - start) / 1000);
				const p = detectPitch(recorder.latest(), recorder.rate),
					x = recorder.take();
				if (x.length) send({ x }, [x.buffer]);
				if (p !== null) trace = [...trace, [now, p]];
				if (now >= LONGEST) done!();
				else frame = requestAnimationFrame(follow);
			};
			frame = requestAnimationFrame(follow);
		});
		const tail = recorder.take();
		send({ x: tail }, [tail.buffer]);
		const x = recorder.stop();
		now = -1;
		if (recording) URL.revokeObjectURL(recording.url);
		recording = { ipa, url: URL.createObjectURL(wav(x, recorder.rate)) };
		phase = 'fit';
		send({ end: true });
		const { fit } = await final;
		worker.terminate();
		busy = null;
		if (!fit || fit.frames < MIN_FRAMES) {
			error = `Only ${fit?.frames ?? 0} moments had a clear pitch. Sing louder or nearer the microphone, and try again.`;
			return;
		}
		last = { ipa, fit };
		const reference = ipa === 'a' ? fit.formants : ah!;
		editable()[ipa] = {
			vowel: 'sung',
			sung: ratios(fit.formants, reference),
			measured: [reference, fit.formants]
		};
	}

	function remeasure() {
		for (const [ipa, f] of stale)
			editable()[ipa] = {
				...f,
				sung: ratios(f.measured[1], ah!),
				measured: [ah!, f.measured[1]]
			};
	}

	/**
	 * What a vowel's sound is: '' for borrowed (or, for a voice type, as all voice types have it), a
	 * vowel of the table, 'sung' or 'fitted'.
	 */
	const source = (ipa: Ipa) => table[ipa]?.vowel ?? (patch.voice ? '' : (TABLE_VOWELS[ipa] ?? ''));
	const hasSung = (f: VowelFormants | undefined) =>
		!!f && (f.vowel === 'sung' || f.measured.length > 0 || f.sung.some((x) => x !== 1));
	/** The vowel that `ipa` sings like while it has no sound of its own. */
	const borrowed = (ipa: Ipa) =>
		vowelFormants({ ...patch, vowels: { ...patch.vowels, [ipa]: undefined } }, ipa, null).from;

	function setSource(ipa: Ipa, value: string) {
		patch.selected = ipa;
		const vowels = editable(),
			own = vowels[ipa];
		if (value === '') delete vowels[ipa];
		else if (hasSung(own) || own?.registers) own!.vowel = value as Vowel | 'sung' | 'fitted';
		else if (value === TABLE_VOWELS[ipa] && !patch.voice) delete vowels[ipa];
		else vowels[ipa] = { vowel: value as Vowel, sung: [1, 1, 1], measured: [] };
		if (patch.voice && !Object.keys(vowels).length) delete patch.voices[patch.voice];
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
		// The stretches left out, behind the pitch.
		ctx.fillStyle = '#4a2530';
		for (const t of progress?.fit?.stray ?? []) ctx.fillRect(x(t), 0, x(STRETCH), h - 30);
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

	const formants = (f: number[]) => `F1 ${f[0]}, F2 ${f[1]}, F3 ${f[2]} Hz`;
	const describe = (fit: Assessment) => {
		const left = fit.stray.length * STRETCH;
		return (
			`${formants(fit.formants)}, from ${noteName(fit.low)} to ${noteName(fit.high)}` +
			(left ? `, leaving out ${left} s that strayed from the rest` : '')
		);
	};
	/** Whether the first and the second time through the bands found the same vowel, and what to say. */
	const check = ({ times }: Assessment) => {
		if (!times)
			return {
				ok: false,
				text: "the bands were sung through only once, so it isn't known whether the vowel stayed the same"
			};
		const [a, b] = times,
			change = a.map((f, i) => Math.abs(Math.log(f / b[i]))),
			i = change.indexOf(Math.max(...change)),
			ok = Math.exp(change[i]) - 1 <= MAX_SPREAD;
		return {
			ok,
			text: ok
				? `the first and the second time through the bands agree within ${Math.round((Math.exp(change[i]) - 1) * 100)}%`
				: `F${i + 1} came out at ${a[i]} Hz the first time through the bands and ${b[i]} Hz the second, so the vowel may have changed`
		};
	};
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
		timbre is the spectral contour, which every vowel shares. A vowel <b>fitted to a choir</b> (in Recorded
		Choir) has formants of its own on each of the three keys, fitted to a recorded choir's notes on it,
		and may have a contour of its own, added to the shared one.
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
	slides, steps or anything, until the frequency bands under the plot have lit up, and then once
	more, so that the two times can be compared; it stops once they're done and the formants hold
	steady, or press Done. The low bands need the pitch to move; low pitches light more of them.
	Stretches that stray from the vowel are left out, and their bands need singing again. Use
	headphones, or nothing else playing.
</p>
{#if busy}
	<p class="hint">
		{nameOf(busy)}: {phase === 'fit'
			? 'finding the formants…'
			: progress?.fit?.time === 3
				? 'waiting for the formants to hold steady'
				: `${progress?.fit?.time === 2 ? 'second' : 'first'} time through: ${full} of ${BANDS - firstNeeded} frequency bands`}{#if progress?.fit && phase === 'record'};
			so far {formants(progress.fit.formants)}{/if}
	</p>
{/if}
<canvas bind:this={canvas} bind:clientWidth={width} style="height: 140px"></canvas>
{#if error}<p class="warn">{error}</p>{/if}
{#if last}
	{@const c = check(last.fit)}
	<p class="hint">
		{nameOf(last.ipa)}: {describe(last.fit)};
		<span class:warn={!c.ok}>{c.text}</span>{#if !c.ok}: sing again, or keep this one{/if}.
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

<p class="voice-types">
	<label
		>Vowels of <select bind:value={patch.voice}>
			<option value={null}>all voices</option>
			{#each VOICE_TYPES as { name } (name)}<option value={name}
					>{name === 'bass' ? 'basses' : `${name}s`}{ownVoices(patch).includes(name)
						? ' (their own)'
						: ''}</option
				>{/each}
		</select></label
	>
	<span class="dim"
		>The choir app gives each vocal part a voice type by its pitch. A voice type with vowels of its
		own sings them, and the vowels of all voices where it has none of its own.</span
	>
</p>
<table class="vowels">
	<tbody>
		{#each LYRIC_VOWELS as v (v.ipa)}
			{@const own = table[v.ipa]}
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
						title={own?.vowel === 'fitted' && own.registers
							? `Fitted: F1–F3 ${own.registers.map((r, g) => `${r.freq.slice(0, 3).join(', ')} Hz on ${noteName(patch.registerKeys[g])}`).join('; ')}${own.contour ? ', with a contour of its own' : ''}${patch.voice && own.range ? `; fitted to notes from ${noteName(own.range[0])} to ${noteName(own.range[1])}, and beyond them fading into the vowel for all voices over ${VOICE_FADE} semitones` : ''}`
							: own?.measured.length
								? `Recorded: F1–F3 ${own.measured[1].join(', ')} Hz`
								: undefined}
					>
						{#if patch.voice}<option value="">as all voices</option>
						{:else if !TABLE_VOWELS[v.ipa]}<option value=""
								>same as {nameOf(borrowed(v.ipa))}</option
							>{/if}
						{#each VOWELS as t (t)}<option value={t}>built-in {tableName(t)}</option>{/each}
						{#if hasSung(own)}<option value="sung">your recording</option>{/if}
						{#if own?.registers}<option value="fitted">fitted to a choir</option>{/if}
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

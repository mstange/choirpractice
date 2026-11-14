<script lang="ts">
	import type { DesignerSynth } from '../designer-synth.ts';
	import type { Patch, Vowel, VowelFormants } from '../patch.ts';
	import { Recorder } from '../recorder.ts';
	import type { SungReply, SungRequest } from '../sung-worker.ts';
	import { sungAh, TABLE_VOWELS, VOWELS, vowelFormants } from '../vowel.ts';
	import { VOWELS as LYRIC_VOWELS, type Ipa } from '../../../../site/src/lib/vowels.ts';
	import { prepare } from './canvas.ts';
	import Slider from './Slider.svelte';

	let {
		patch,
		synth,
		singVowels = $bindable()
	}: { patch: Patch; synth: DesignerSynth | null; singVowels: boolean } = $props();

	/** The ranges to slide over, an octave each. */
	const RANGES: [string, number][] = [
		['A2–A3', 45],
		['D3–D4', 50],
		['A3–A4', 57]
	];
	/** Seconds of the starting tone, and of the slide up and back down. */
	const CUE = 3,
		SLIDE = 8;
	/** The fewest frames with a clear pitch that a fit is made from, and the most error trusted. */
	const MIN_FRAMES = 100,
		MAX_ERROR = 6;

	const nameOf = (ipa: Ipa) => LYRIC_VOWELS.find((v) => v.ipa === ipa)!.name;
	/** The table's vowels by the name of the choir app's vowel that they are. */
	const tableName = (v: Vowel) =>
		nameOf(Object.entries(TABLE_VOWELS).find(([, t]) => t === v)![0] as Ipa);

	let low = $state(RANGES[0][1]),
		busy = $state<Ipa | null>(null),
		phase = $state<'cue' | 'record' | 'fit'>('cue'),
		error = $state(''),
		last = $state<{ ipa: Ipa; r: SungReply } | null>(null);
	/** The time since the cue started, and the pitch sung, for the plot. */
	let now = $state(-1),
		trace = $state.raw<[number, number][]>([]);

	const ah = $derived(sungAh(patch));
	/** The sung vowels that were measured against another "ah" than the sung a's. */
	const stale = $derived(
		ah
			? (Object.entries(patch.vowels) as [Ipa, VowelFormants][]).filter(
					([ipa, f]) => ipa !== 'a' && f.measured.length && f.measured[0].join() !== ah.join()
				)
			: []
	);

	/** The pitch to sing at `t` seconds from the start of the cue. */
	const target = (t: number) => {
		const s = Math.max(0, t - CUE);
		return low + 12 * (s < SLIDE / 2 ? s / (SLIDE / 2) : Math.max(0, 2 - s / (SLIDE / 2)));
	};

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
		const start = performance.now();
		let frame = 0;
		const follow = () => {
			now = (performance.now() - start) / 1000;
			const p = recorder.pitch();
			if (p !== null) trace = [...trace, [now, p]];
			frame = requestAnimationFrame(follow);
		};
		follow();
		phase = 'cue';
		await recorder.cue(low, CUE);
		phase = 'record';
		const x = await recorder.record(SLIDE);
		cancelAnimationFrame(frame);
		now = -1;
		phase = 'fit';
		const r = await fit(x, recorder.rate);
		busy = null;
		if (r.frames < MIN_FRAMES) {
			error = `Only ${r.frames} moments had a clear pitch. Sing louder or nearer the microphone, along the line, and try again.`;
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
		const total = CUE + SLIDE,
			x = (t: number) => (t / total) * w,
			y = (m: number) => h - 6 - ((m - low + 2) / 16) * (h - 12);
		ctx.strokeStyle = '#2c303a';
		ctx.fillStyle = '#6a7080';
		for (const m of [low, low + 6, low + 12]) {
			ctx.beginPath();
			ctx.moveTo(0, y(m));
			ctx.lineTo(w, y(m));
			ctx.stroke();
			ctx.fillText(noteName(m), 2, y(m) - 2);
		}
		ctx.beginPath();
		ctx.moveTo(x(CUE), 0);
		ctx.lineTo(x(CUE), h);
		ctx.stroke();
		// The line to sing along, and what was sung.
		ctx.strokeStyle = '#f0b429';
		ctx.lineWidth = 3;
		ctx.beginPath();
		for (let px = 0; px <= w; px += 2) ctx.lineTo(px, y(target((px / w) * total)));
		ctx.stroke();
		ctx.lineWidth = 1;
		ctx.fillStyle = '#60d0e0';
		for (const [t, m] of trace) ctx.fillRect(x(t) - 1.5, y(m) - 1.5, 3, 3);
		if (now >= 0) {
			ctx.strokeStyle = '#fff';
			ctx.beginPath();
			ctx.moveTo(x(now), 0);
			ctx.lineTo(x(now), h);
			ctx.stroke();
		}
	});

	const describe = (r: SungReply) =>
		`F1 ${r.formants[0]}, F2 ${r.formants[1]}, F3 ${r.formants[2]} Hz, from ${noteName(r.low)} to ${noteName(r.high)}, ` +
		`${r.error.toFixed(1)} dB from the fit`;
</script>

<p class="hint">
	The choir app sings each syllable on its vowel: "moon" on oo, "night" on ah moving to ih. Each
	vowel below sounds like a vowel of Csound's table, like one that you sang, or, until you give it a
	sound, like the nearest vowel that has one. The selected vowel is the one that the keyboard and
	the plots play, and that Match fits the contour around.
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
		in both and cancel out: it moves the formants of the table's ah by the ratios of your vowel's
		formants to your "ah"'s. So sing "ah" first, in the ah row, and then the other vowels. The ah
		row then sounds sung, which is the same as the table's ah.
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
	Sing: hold the starting tone while it plays, then slide up and back down along the yellow line, in
	a range that is comfortable. Use headphones, or nothing else playing.
</p>
<div class="row">
	Range
	{#each RANGES as [label, key] (key)}
		<button class:on={low === key} disabled={!!busy} onclick={() => (low = key)}>{label}</button>
	{/each}
	{#if busy}
		<span class="hint"
			>{nameOf(busy)}: {phase === 'cue'
				? `starting tone ${noteName(low)}…`
				: phase === 'record'
					? 'slide up and back down'
					: 'finding the formants…'}</span
		>
	{/if}
</div>
<canvas bind:this={canvas} bind:clientWidth={width} style="height: 110px"></canvas>
{#if error}<p class="warn">{error}</p>{/if}
{#if last}
	<p class="hint">
		{nameOf(last.ipa)}: {describe(last.r)}{#if last.r.error > MAX_ERROR}<span class="warn">
				— a poor fit: try again, more steadily</span
			>{/if}.
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
					>
						{#if !TABLE_VOWELS[v.ipa]}<option value="">like {nameOf(borrowed(v.ipa))}</option>{/if}
						{#each VOWELS as t (t)}<option value={t}>table {tableName(t)}</option>{/each}
						{#if hasSung(own)}<option value="sung">sung</option>{/if}
					</select>
				</td>
				<td>
					<button
						disabled={!!busy || (v.ipa !== 'a' && !ah)}
						title={v.ipa !== 'a' && !ah ? 'Sing "ah" first' : `Sing ${v.name} as in ${v.word}`}
						onclick={() => sing(v.ipa)}>{busy === v.ipa ? 'Singing…' : 'Sing'}</button
					>
				</td>
				<td class="dim">
					{#if own?.measured.length}F1–F3 {own.measured[1].join(', ')} Hz{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.row {
		display: flex;
		gap: 4px;
		align-items: center;
		margin: 4px 0;
	}
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
	}
	.vowels .selected {
		background: #2c303a;
	}
	.dim {
		color: var(--dim);
	}
</style>

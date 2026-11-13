<script lang="ts">
	import { Builder } from './lib/builder.svelte.ts';
	import { DESIGNED, INSTRUMENTS, type DesignerSynth } from './lib/designer-synth.ts';
	import { match } from './lib/matcher.ts';
	import {
		CONTOUR_FREQS,
		CONTOUR_KEYS,
		MATCH_KEYS,
		complete,
		type EqType,
		type Patch,
		type Vowel
	} from './lib/patch.ts';
	import { STARTING_POINTS } from './lib/presets.ts';
	import Contour from './lib/ui/Contour.svelte';
	import Harmonics from './lib/ui/Harmonics.svelte';
	import Keyboard from './lib/ui/Keyboard.svelte';
	import Player from './lib/ui/Player.svelte';
	import Preview from './lib/ui/Preview.svelte';
	import Response from './lib/ui/Response.svelte';
	import Slider from './lib/ui/Slider.svelte';

	const STORE = 'soundfont-designer:patch',
		SAVED = 'soundfont-designer:saved',
		PROGRAM = 'soundfont-designer:program';
	let patch = $state<Patch>(complete(JSON.parse(localStorage.getItem(STORE) ?? '{}')));
	/** Patches saved by name. */
	let saved = $state<Record<string, Patch>>(JSON.parse(localStorage.getItem(SAVED) ?? '{}'));
	/** The General MIDI program of the exported file's preset. */
	let program = $state(Number(localStorage.getItem(PROGRAM) ?? DESIGNED));
	let previewKey = $state(60);
	let synth = $state.raw<DesignerSynth | null>(null);
	const builder = new Builder();

	$effect(() => {
		const p = $state.snapshot(patch) as Patch;
		localStorage.setItem(STORE, JSON.stringify(p));
		builder.build(p, DESIGNED, previewKey);
	});
	$effect(() => localStorage.setItem(SAVED, JSON.stringify(saved)));
	$effect(() => localStorage.setItem(PROGRAM, String(program)));

	const built = $derived(builder.built);
	const VOWELS: Vowel[] = ['a', 'e', 'i', 'o', 'u'];
	const EQ_TYPES: EqType[] = ['lowshelf', 'peak', 'highshelf'];
	const SHAPES: [string, number, number][] = [
		['Saw', -6, 0],
		['Square', -6, -60],
		['Triangle', -12, -60],
		['Voice', -12, 0]
	];
	const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

	function download(name: string, data: BlobPart, type: string) {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([data], { type }));
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	let exporting = $state(false),
		exportError = $state('');
	async function exportSf3() {
		exporting = true;
		exportError = '';
		try {
			const file = await builder.export($state.snapshot(patch) as Patch, program);
			download(`${slug(patch.name)}-${program}.sf3`, file, 'audio/x-soundfont');
		} catch (e) {
			exportError = `Export failed: ${(e as Error).message}`;
		} finally {
			exporting = false;
		}
	}

	/** The register of the contour that is drawn on. */
	let contourRegister = $state(0);
	const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
	const noteName = (key: number) => `${NOTE_NAMES[key % 12]}${Math.floor(key / 12) - 1}`;
	/** The instrument that Match measures, and what the last match did. */
	let matchProgram = $state(52),
		matching = $state(false),
		matchResult = $state('');
	async function matchContour() {
		matching = true;
		const label = INSTRUMENTS.find(([p]) => p === matchProgram)![1];
		const r = await match($state.snapshot(patch) as Patch, matchProgram);
		matching = false;
		if ('error' in r) matchResult = `Couldn't match: ${r.error}`;
		else {
			patch.contour = r.contour;
			matchResult =
				`Matched to ${label}: the harmonics were ${r.before.toFixed(1)} dB (rms) from ` +
				`${label}'s, and are now about ${r.after.toFixed(1)} dB: ` +
				MATCH_KEYS.map((key, k) => `${noteName(key)} ${r.keys[k].toFixed(1)}`).join(', ') +
				'.';
		}
	}

	async function importJson(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		if (file) patch = complete(JSON.parse(await file.text()));
		e.currentTarget.value = '';
	}
</script>

<header>
	<h1>Soundfont Designer</h1>
	<input class="name" bind:value={patch.name} title="The preset's name" />
	<select
		onchange={(e) => {
			const i = +e.currentTarget.value;
			if (i >= 0) patch = structuredClone(STARTING_POINTS[i]);
			e.currentTarget.value = '-1';
		}}
	>
		<option value="-1">Start from…</option>
		{#each STARTING_POINTS as p, i (p.name)}<option value={i}>{p.name}</option>{/each}
	</select>
	<select
		onchange={(e) => {
			const name = e.currentTarget.value;
			if (name) patch = complete(structuredClone(saved[name]));
			e.currentTarget.value = '';
		}}
	>
		<option value="">Open saved…</option>
		{#each Object.keys(saved).sort() as name (name)}<option value={name}>{name}</option>{/each}
	</select>
	<button onclick={() => (saved[patch.name] = $state.snapshot(patch) as Patch)}>Save</button>
	<button
		disabled={!(patch.name in saved)}
		onclick={() => {
			delete saved[patch.name];
			saved = { ...saved };
		}}>Delete</button
	>
	<button
		onclick={() =>
			download(
				`${slug(patch.name)}.json`,
				JSON.stringify($state.snapshot(patch), null, '\t'),
				'application/json'
			)}>Export JSON</button
	>
	<label class="file">Import JSON <input type="file" accept=".json" onchange={importJson} /></label>
	<span class="spacer"></span>
	<label title="The General MIDI program of the preset in the exported file">
		Program <input type="number" min="0" max="127" bind:value={program} />
	</label>
	{#if exportError}<span class="warn">{exportError}</span>{/if}
	<button class="on" onclick={exportSf3} disabled={exporting}>
		{exporting ? 'Compressing…' : 'Export SF3'}
	</button>
</header>

<main>
	<section class="player">
		<Player {built} bind:synth />
	</section>

	<div class="grid">
		<section>
			<h2>Tone: harmonics</h2>
			<Harmonics {patch} {previewKey} />
			<p class="hint">
				Drag to draw the harmonics of the preview key, as levels before the loudness is normalized;
				the white marks are where they are without your changes.
			</p>
			<div class="buttons">
				{#each SHAPES as [label, tilt, even] (label)}
					<button onclick={() => ((patch.tone.tilt = tilt), (patch.tone.even = even))}
						>{label}</button
					>
				{/each}
				<button onclick={() => patch.tone.harmonics.fill(0)}>Undo drawing</button>
			</div>
			<Slider label="Level" bind:value={patch.tone.level} min={-30} max={12} step={0.5} unit="dB" />
			<Slider
				label="Tilt"
				bind:value={patch.tone.tilt}
				min={-24}
				max={0}
				step={0.5}
				unit="dB/oct"
			/>
			<Slider label="Even harmonics" bind:value={patch.tone.even} min={-60} max={12} unit="dB" />
			<Slider label="Top harmonic" bind:value={patch.tone.maxHarmonic} min={1} max={128} />
			<Slider
				label="Voices"
				bind:value={patch.tone.voices}
				min={1}
				max={7}
				title="Detuned copies, for an ensemble"
			/>
			<Slider label="Detune" bind:value={patch.tone.detune} min={0} max={60} unit="cents" />
			<Slider
				label="Fundamental detune"
				bind:value={patch.tone.fundamentalDetune}
				min={0}
				max={60}
				unit="cents"
				title="Detune of the fundamental's copies; they beat into a throb of the whole note, and 0 has none"
			/>
			<Slider
				label="Stereo width"
				bind:value={patch.tone.width}
				min={0}
				max={100}
				unit="%"
				title="0 is one mono sample; above, a left and a right sample with an ensemble each, panned apart by this much"
			/>
			<Slider
				label="Breath noise"
				bind:value={patch.tone.noise}
				min={-90}
				max={0}
				unit="dB"
				title="-90 is off"
			/>
			<Slider
				label="Noise from"
				bind:value={patch.tone.noiseLow}
				min={50}
				max={10000}
				log
				unit="Hz"
			/>
			<Slider
				label="Noise to"
				bind:value={patch.tone.noiseHigh}
				min={200}
				max={16000}
				log
				unit="Hz"
			/>
			<Slider
				label="Aperiodic"
				bind:value={patch.tone.aperiodic}
				min={-90}
				max={0}
				unit="dB"
				title="Noise between the harmonics, shaped like them: between two neighbours, against them, at 1 kHz on C4; -90 is off"
			/>
			<Slider
				label="Aperiodic slope"
				bind:value={patch.tone.aperiodicSlope}
				min={-24}
				max={12}
				unit="dB/oct"
				title="How much the aperiodic noise changes per octave of key"
			/>
			<Slider
				label="Aperiodic tilt"
				bind:value={patch.tone.aperiodicTilt}
				min={-12}
				max={12}
				unit="dB/oct"
				title="How much the aperiodic noise changes against the harmonics per octave of frequency, from 1 kHz"
			/>
		</section>

		<section>
			<h2>EQ and formants</h2>
			<Response {patch} {previewKey} />
			<p class="hint">
				Drag the EQ handles, scroll on one for its Q. Green is the EQ, purple dashed the formants,
				white both. The marks at the bottom are the preview key's harmonics, blue the breath noise.
				The EQ applies to both layers, the formants to the tone.
			</p>
			<div class="buttons">
				Vowel
				{#each VOWELS as v (v)}
					<button class:on={patch.formant.vowel === v} onclick={() => (patch.formant.vowel = v)}
						>{v}</button
					>
				{/each}
			</div>
			<Slider label="Formants" bind:value={patch.formant.amount} min={0} max={1} step={0.05} />
			<Slider
				label="Formant width"
				bind:value={patch.formant.width}
				min={0.5}
				max={4}
				step={0.1}
				unit="×"
			/>
			<table class="eq">
				<tbody>
					{#each patch.eq as band, i (i)}
						<tr>
							<td>{i + 1}</td>
							<td>
								<select bind:value={band.type}>
									{#each EQ_TYPES as t (t)}<option value={t}>{t}</option>{/each}
								</select>
							</td>
							<td><input type="number" min="20" max="16000" bind:value={band.freq} /> Hz</td>
							<td
								><input type="number" min="-24" max="24" step="0.5" bind:value={band.gain} /> dB</td
							>
							<td>Q <input type="number" min="0.1" max="10" step="0.1" bind:value={band.q} /></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>

		<section>
			<h2>Tone: spectral contour</h2>
			<Contour {patch} {previewKey} register={contourRegister} />
			<p class="hint">
				Raises and lowers the tone, harmonics and breath noise, at fixed frequencies. There is a
				contour for E2, A#3 and E5, and the keys in between mix their neighbours: draw on any; the
				dashed line is the preview key's. Match measures the sustain of an instrument and of this
				patch at mf, on every third key from E2 to G5, and sets the contour that brings this patch's
				harmonics nearest the instrument's.
			</p>
			<div class="buttons">
				Draw
				{#each CONTOUR_KEYS as key, g (key)}
					<button class:on={contourRegister === g} onclick={() => (contourRegister = g)}
						>{noteName(key)}</button
					>
				{/each}
			</div>
			<div class="buttons">
				<select bind:value={matchProgram}>
					{#each INSTRUMENTS.filter(([p]) => p !== DESIGNED) as [p, label] (p)}<option value={p}
							>{label}</option
						>{/each}
				</select>
				<button disabled={matching} onclick={matchContour}
					>{matching ? 'Matching…' : 'Match'}</button
				>
				<button
					onclick={() =>
						(patch.contour = CONTOUR_KEYS.map(() => Array(CONTOUR_FREQS.length).fill(0)))}
					>Flat</button
				>
			</div>
			{#if matchResult}<p class="hint">{matchResult}</p>{/if}
		</section>

		<section>
			<h2>Note</h2>
			<Preview {built} />
			<p class="hint">
				The designed instrument as the synthesizer plays it: a note at MuseScore's p, mf and ff, and
				one that swells from p to ff, released at the dashed line.
			</p>
		</section>

		<section>
			<h2>Tone: envelope and onset</h2>
			<Slider label="Attack" bind:value={patch.env.attack} min={1} max={2000} log unit="ms" />
			<Slider label="Hold" bind:value={patch.env.hold} min={0} max={2000} step={5} unit="ms" />
			<Slider label="Decay" bind:value={patch.env.decay} min={1} max={5000} log unit="ms" />
			<Slider
				label="Sustain"
				bind:value={patch.env.sustain}
				min={-48}
				max={0}
				step={0.5}
				unit="dB"
			/>
			<Slider label="Release" bind:value={patch.env.release} min={1} max={5000} log unit="ms" />
			<p class="hint">
				At its start, the tone can be brighter and start flat, and settles in the onset's time.
			</p>
			<Slider label="Onset time" bind:value={patch.onset.time} min={1} max={1000} log unit="ms" />
			<Slider
				label="Onset bright"
				bind:value={patch.onset.bright}
				min={0}
				max={4800}
				step={50}
				unit="cents"
			/>
			<Slider label="Scoop" bind:value={patch.onset.scoop} min={0} max={200} unit="cents" />
		</section>

		<section>
			<h2>
				<label><input type="checkbox" bind:checked={patch.attack.enabled} /> Attack layer</label>
			</h2>
			<p class="hint">
				A short transient on top of the tone, which marks where each note starts: decaying partials,
				like a plucked or struck string, and a noise burst. It follows the velocity.
			</p>
			<Slider
				label="Level"
				bind:value={patch.attack.level}
				min={-40}
				max={12}
				step={0.5}
				unit="dB"
			/>
			<Slider label="Decay" bind:value={patch.attack.decay} min={5} max={2000} log unit="ms" />
			<Slider
				label="Damping"
				bind:value={patch.attack.damping}
				min={0}
				max={2}
				step={0.05}
				title="How much faster higher partials decay"
			/>
			<Slider
				label="Tilt"
				bind:value={patch.attack.tilt}
				min={-24}
				max={0}
				step={0.5}
				unit="dB/oct"
			/>
			<Slider
				label="Inharmonicity"
				bind:value={patch.attack.inharmonicity}
				min={0}
				max={1}
				step={0.01}
				title="Stretches the partials, as a piano's"
			/>
			<Slider label="Noise burst" bind:value={patch.attack.noise} min={-90} max={12} unit="dB" />
			<Slider
				label="Noise at"
				bind:value={patch.attack.noiseFreq}
				min={100}
				max={12000}
				log
				unit="Hz"
			/>
			<Slider
				label="Noise decay"
				bind:value={patch.attack.noiseDecay}
				min={1}
				max={500}
				log
				unit="ms"
			/>
			<Slider
				label="Velocity range"
				bind:value={patch.attack.velRange}
				min={0}
				max={96}
				unit="dB"
			/>
		</section>

		<section>
			<h2>Dynamics and filter</h2>
			<p class="hint">
				MuseScore exports the dynamics, hairpins too, as CC2, which changes during notes. The
				velocity only says how loud a note starts.
			</p>
			<label class="choice">
				Tone follows
				<select bind:value={patch.dynamics.source}>
					<option value="cc2">CC2 (breath)</option>
					<option value="velocity">velocity</option>
				</select>
			</label>
			<Slider
				label="Range"
				bind:value={patch.dynamics.range}
				min={0}
				max={96}
				unit="dB"
				title="Depth of the volume modulator; the SF2 default for velocity is 96"
			/>
			<Slider
				label="Darker when soft"
				bind:value={patch.dynamics.brightness}
				min={0}
				max={6000}
				step={100}
				unit="cents"
				title="How much lower the filter is at the softest"
			/>
			<Slider
				label="Filter at harmonic"
				bind:value={patch.filter.harmonic}
				min={1}
				max={64}
				log
				title="64 is off"
			/>
			<Slider label="Resonance" bind:value={patch.filter.q} min={0} max={24} step={0.5} unit="dB" />
		</section>

		<section>
			<h2>Vibrato and tremolo</h2>
			<Slider
				label="Vibrato rate"
				bind:value={patch.vibrato.rate}
				min={0.5}
				max={10}
				step={0.1}
				unit="Hz"
			/>
			<Slider
				label="Vibrato depth"
				bind:value={patch.vibrato.depth}
				min={0}
				max={100}
				unit="cents"
			/>
			<Slider
				label="Delay"
				bind:value={patch.vibrato.delay}
				min={0}
				max={2000}
				step={10}
				unit="ms"
				title="Before vibrato and tremolo start"
			/>
			<Slider
				label="Tremolo rate"
				bind:value={patch.tremolo.rate}
				min={0.5}
				max={10}
				step={0.1}
				unit="Hz"
			/>
			<Slider
				label="Tremolo depth"
				bind:value={patch.tremolo.depth}
				min={0}
				max={12}
				step={0.5}
				unit="dB"
			/>
		</section>

		<section>
			<h2>Output</h2>
			<Slider
				label="Key spacing"
				bind:value={patch.output.spacing}
				min={1}
				max={12}
				unit="keys"
				title="Semitones between the keys that get their own samples"
			/>
			<Slider
				label="Loop"
				bind:value={patch.output.loop}
				min={0.5}
				max={4}
				step={0.5}
				unit="s"
				title="Length of the tone's loop; longer loops repeat less audibly, and detuned voices beat more slowly"
			/>
			<label class="choice">
				Sample rate
				<select bind:value={patch.output.sampleRate}>
					{#each [22050, 32000, 44100, 48000] as r (r)}<option value={r}>{r} Hz</option>{/each}
				</select>
			</label>
			<Slider label="Reverb" bind:value={patch.output.reverb} min={0} max={100} unit="%" />
			<Slider label="Chorus" bind:value={patch.output.chorus} min={0} max={100} unit="%" />
			<Slider label="Random seed" bind:value={patch.output.seed} min={1} max={99} />
			{#if built}
				<p class="hint">
					{built.samples.length} samples, {(built.file.byteLength / 1e6).toFixed(1)} MB, built in
					{built.ms.toFixed(0)} ms.
				</p>
				{#if built.clipped.length}
					<p class="warn">
						Too loud for its samples on {built.clipped.length} keys: lower the level.
					</p>
				{/if}
			{/if}
			{#if builder.error}<p class="warn">{builder.error}</p>{/if}
		</section>
	</div>
</main>

<footer>
	<Keyboard {synth} {built} bind:previewKey />
</footer>

<style>
	header {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		padding: 8px 12px;
		border-bottom: 1px solid var(--line);
	}
	h1 {
		font-size: 15px;
		margin: 0 8px 0 0;
	}
	.name {
		width: 12em;
	}
	.spacer {
		flex: 1;
	}
	.file input {
		display: none;
	}
	.file {
		border: 1px solid var(--line);
		border-radius: 4px;
		padding: 2px 6px;
		background: #2a2e38;
		cursor: pointer;
	}
	main {
		padding: 10px 12px 130px;
	}
	section {
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 10px;
	}
	.player {
		margin-bottom: 10px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
		gap: 10px;
	}
	.buttons {
		display: flex;
		gap: 4px;
		align-items: center;
		margin: 4px 0;
	}
	.choice {
		display: block;
		margin: 4px 0;
	}
	.eq input[type='number'] {
		width: 4em;
	}
	.eq td {
		padding: 1px 4px 1px 0;
		color: var(--dim);
	}
	.warn {
		color: #e8657a;
	}
	footer {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 6px 12px 8px;
		background: #111317ee;
		border-top: 1px solid var(--line);
	}
</style>

<script lang="ts">
	import { untrack } from 'svelte';
	import type { Built } from '../build-worker.ts';
	import type { DesignerSynth } from '../designer-synth.ts';

	let {
		synth,
		built,
		previewKey = $bindable()
	}: { synth: DesignerSynth | null; built: Built | null; previewKey: number } = $props();

	const LOW = 36,
		HIGH = 84;
	/** Computer keys from C, as on a piano: the home row white, the row above black. */
	const KEYS = "awsedftgyhujkolp;'";
	const BLACK = [1, 3, 6, 8, 10];
	const isBlack = (k: number) => BLACK.includes(k % 12);
	const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
	const name = (k: number) => `${NAMES[k % 12]}${Math.floor(k / 12) - 1}`;

	let velocity = $state(80);
	/** While a key is held, CC2 rises from `velocity` to 127 and back, every SWELL seconds. */
	let swell = $state(false);
	/** Keys sound until pressed again, and sound anew with each new version of the instrument. */
	let latch = $state(false);
	let octave = $state(48);
	let held = $state(new Set<number>());

	const SWELL = 4;
	let swellStart = 0,
		frame = 0;

	function breath() {
		if (!synth) return;
		if (!swell || !held.size) return synth.breathe(velocity);
		const phase = ((performance.now() - swellStart) / 1000 / SWELL) % 1;
		const up = phase < 0.5 ? phase * 2 : 2 - phase * 2;
		synth.breathe(Math.round(velocity + (127 - velocity) * up));
		frame = requestAnimationFrame(breath);
	}

	function down(key: number) {
		if (!synth) return;
		if (held.has(key)) {
			if (latch) up(key, true);
			return;
		}
		if (!held.size) swellStart = performance.now();
		held.add(key);
		held = new Set(held);
		previewKey = key;
		cancelAnimationFrame(frame);
		breath();
		synth.noteOn(key, velocity);
	}

	function up(key: number, force = false) {
		if (!held.has(key) || (latch && !force)) return;
		held.delete(key);
		held = new Set(held);
		synth?.noteOff(key);
	}

	// Latched notes sound with each new version of the instrument.
	$effect(() => {
		if (!built || !latch) return;
		untrack(() => {
			for (const key of held) {
				synth?.noteOff(key);
				synth?.noteOn(key, velocity);
			}
		});
	});

	$effect(() => {
		if (!latch) untrack(() => held.forEach((key) => up(key, true)));
	});

	const typing = (e: KeyboardEvent) =>
		e.metaKey || e.ctrlKey || e.altKey || (e.target as Element).closest('input, select, textarea');

	function keydown(e: KeyboardEvent) {
		if (typing(e) || e.repeat) return;
		if (e.key === 'z') octave = Math.max(24, octave - 12);
		else if (e.key === 'x') octave = Math.min(84, octave + 12);
		const i = KEYS.indexOf(e.key);
		if (i >= 0) down(octave + i);
	}
	function keyup(e: KeyboardEvent) {
		const i = KEYS.indexOf(e.key);
		if (i >= 0) up(octave + i);
	}

	const whites = Array.from({ length: HIGH - LOW + 1 }, (_, i) => LOW + i).filter(
		(k) => !isBlack(k)
	);
</script>

<svelte:window onkeydown={keydown} onkeyup={keyup} />

<div class="bar">
	<label title="The velocity, and the CC2 that notes start with">
		Velocity <input type="range" min="1" max="127" bind:value={velocity} />
		{velocity}
	</label>
	<button
		class:on={swell}
		onclick={() => (swell = !swell)}
		title="CC2 swells to 127 and back while a key is held"
	>
		Swell
	</button>
	<button
		class:on={latch}
		onclick={() => (latch = !latch)}
		title="Keys stay down until pressed again, and sound anew with each change to the instrument"
	>
		Latch
	</button>
	<span class="hint">
		Keys {KEYS.slice(0, 13).toUpperCase()} play from {name(octave)}, Z and X change the octave.
		Plots show {name(previewKey)}.
	</span>
</div>
<div class="keys" role="group" aria-label="Keyboard">
	{#each whites as key (key)}
		<button
			class="white"
			class:held={held.has(key)}
			class:preview={key === previewKey}
			onpointerdown={() => down(key)}
			onpointerup={() => up(key)}
			onpointerleave={() => up(key)}
		>
			{#if key % 12 === 0}<span>{name(key)}</span>{/if}
			{#if key < HIGH && isBlack(key + 1)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<span
					class="black"
					class:held={held.has(key + 1)}
					class:preview={key + 1 === previewKey}
					onpointerdown={(e) => {
						e.stopPropagation();
						down(key + 1);
					}}
					onpointerup={(e) => {
						e.stopPropagation();
						up(key + 1);
					}}
					onpointerleave={() => up(key + 1)}
				></span>
			{/if}
		</button>
	{/each}
</div>

<style>
	.bar {
		display: flex;
		gap: 10px;
		align-items: center;
		margin-bottom: 4px;
	}
	.keys {
		display: flex;
		height: 70px;
		user-select: none;
		touch-action: none;
	}
	.white {
		flex: 1;
		position: relative;
		background: #e6e6e6;
		border: 1px solid #555;
		border-radius: 0 0 3px 3px;
		padding: 0;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		color: #555;
		font-size: 10px;
	}
	.black {
		position: absolute;
		z-index: 1;
		top: 0;
		right: -30%;
		width: 60%;
		height: 60%;
		background: #222;
		border-radius: 0 0 2px 2px;
	}
	.preview {
		box-shadow: inset 0 -4px 0 #5a9cf0;
	}
	.held {
		background: var(--accent);
	}
</style>

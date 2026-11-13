<script lang="ts">
	let {
		label,
		value = $bindable(),
		min,
		max,
		step = 1,
		unit = '',
		log = false,
		title = ''
	}: {
		label: string;
		value: number;
		min: number;
		max: number;
		step?: number;
		unit?: string;
		/** Whether the slider moves the value by ratios rather than steps. */
		log?: boolean;
		title?: string;
	} = $props();

	const pos = $derived(log ? Math.log(value / min) / Math.log(max / min) : value);
	const set = (p: number) => (value = log ? Number((min * (max / min) ** p).toPrecision(3)) : p);
</script>

<label class="slider" {title}>
	<span class="name">{label}</span>
	<input
		type="range"
		min={log ? 0 : min}
		max={log ? 1 : max}
		step={log ? 0.001 : step}
		value={pos}
		oninput={(e) => set(+e.currentTarget.value)}
	/>
	<input
		type="number"
		{min}
		{max}
		step={log ? 'any' : step}
		{value}
		onchange={(e) => (value = Math.min(max, Math.max(min, +e.currentTarget.value)))}
	/>
	<span class="unit">{unit}</span>
</label>

<style>
	.slider {
		display: grid;
		grid-template-columns: 7.5em 1fr 4.5em 3.2em;
		gap: 6px;
		align-items: center;
		margin: 2px 0;
	}
	.name {
		color: var(--dim);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.unit {
		color: var(--dim);
		font-size: 11px;
	}
</style>

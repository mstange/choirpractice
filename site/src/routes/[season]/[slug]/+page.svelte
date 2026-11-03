<script lang="ts">
	import Player from '#lib/Player.svelte';

	let { data } = $props();
</script>

{#key data.entry.slug}
	<Player season={data.season} entry={data.entry} piece={data.piece} pieces={data.pieces} />
{/key}

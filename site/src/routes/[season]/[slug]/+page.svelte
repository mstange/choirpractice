<script lang="ts">
	import { onDestroy } from 'svelte';
	import Player from '#lib/Player.svelte';
	import { Session } from '#lib/session.svelte.ts';

	let { data } = $props();

	// This page stays when another piece is picked, and so does the session.
	const session = new Session();
	onDestroy(() => session.mic.stop());
</script>

{#key data.entry.slug}
	<Player
		season={data.season}
		entry={data.entry}
		piece={data.piece}
		pieces={data.pieces}
		{session}
	/>
{/key}

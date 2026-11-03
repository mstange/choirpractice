<script lang="ts">
	import { onDestroy } from 'svelte';
	import { page } from '$app/state';
	import Player from '#lib/Player.svelte';
	import { Session } from '#lib/session.svelte.ts';

	let { data } = $props();
	const view = $derived(page.params.view === 'lyrics' ? 'lyrics' : 'pitch');

	// This page stays when another piece or view is picked, and so does the session.
	const session = new Session();
	onDestroy(() => session.mic.stop());
</script>

{#key data.entry.slug}
	<Player
		season={data.season}
		entry={data.entry}
		piece={data.piece}
		pieces={data.pieces}
		{view}
		{session}
	/>
{/key}

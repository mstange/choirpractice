<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head><title>Choir player</title></svelte:head>

<main>
	<h1>Choir player</h1>
	<p>
		Plays a choir piece with each part’s notes and lyrics. Open it with the link your choir gave
		you.
	</p>
	<p>
		<a href={resolve('/[season]', { season: 'demo' })}>Try it with Frère Jacques</a>, a round in
		four parts.
	</p>
</main>

<style>
	a {
		color: inherit;
	}

	main {
		max-width: 36em;
		margin: 15vh auto;
		padding: 0 1em;
	}
</style>

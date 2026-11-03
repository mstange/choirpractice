<script lang="ts">
	import { page } from '$app/state';
</script>

<main>
	<h1>{page.status === 404 ? 'Not found' : 'Something went wrong'}</h1>
	<p>{page.error?.message}</p>
</main>

<style>
	main {
		max-width: 36em;
		margin: 15vh auto;
		padding: 0 1em;
	}
</style>

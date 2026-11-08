<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Page from '#lib/Page.svelte';
</script>

<Page>
	<h1>{page.status === 404 ? 'Not found' : 'Something went wrong'}</h1>
	<p class="muted">{page.error?.message}</p>
	<a class="button" href={resolve('/')}>To the start page</a>
</Page>

<style>
	h1 {
		font-size: clamp(32px, 5vw, 48px);
		margin: 6vh 0 8px;
	}

	p {
		margin: 0 0 24px;
		font-size: 17px;
	}
</style>

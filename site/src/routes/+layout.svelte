<script lang="ts">
	import '../app.css';
	// It listens for the browser's install prompt from the start.
	import '#lib/install.svelte.ts';

	let { children } = $props();
</script>

{@render children()}

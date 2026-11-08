<script lang="ts">
	import type { Snippet } from 'svelte';
	import { asset, resolve } from '$app/paths';

	// The frame of the start page, the season pages and the error page: the site's name, which links
	// to the start page, above the content, on a background in the given hue.
	let { hue = 215, children }: { hue?: number; children: Snippet } = $props();
</script>

<div class="page" style:--hue={hue}>
	<header>
		<a class="brand" href={resolve('/')}>
			<img src={asset('icon.svg')} alt="" width="28" height="28" />
			Choir player
		</a>
	</header>
	<main>
		{@render children()}
	</main>
</div>

<style>
	/* The player keeps the body from scrolling; these pages scroll the document, so that a phone's
	   browser can hide its address bar. */
	:global(html:has(.page)),
	:global(html:has(.page) body) {
		height: auto;
		overflow: visible;
	}

	.page {
		min-height: 100dvh;
		background:
			radial-gradient(ellipse 120% 600px at 50% 0%, hsl(var(--hue) 45% 20%), transparent),
			hsl(var(--hue) 25% 7%);
		font-size: 16px;
		line-height: 1.5;
		padding: 0 max(20px, env(safe-area-inset-left)) 64px;
	}

	header,
	main {
		max-width: 1040px;
		margin: 0 auto;
	}

	header {
		padding: max(16px, env(safe-area-inset-top)) 0 16px;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: inherit;
		text-decoration: none;
		font-weight: 600;
	}

	.brand img {
		border-radius: 7px;
	}

	/* Shared by the pages inside. */
	main :global(h1),
	main :global(h2) {
		font-family: var(--lyric-font);
		font-style: italic;
		font-weight: 600;
		line-height: 1.15;
		text-wrap: balance;
	}

	main :global(h2) {
		font-size: 26px;
		margin: 0 0 16px;
	}

	main :global(section) {
		margin-top: 56px;
	}

	@media (max-width: 760px) {
		main :global(section) {
			margin-top: 44px;
		}
	}

	main :global(.button) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 44px;
		padding: 0 20px;
		border-radius: 22px;
		font: inherit;
		font-weight: 600;
		color: inherit;
		text-decoration: none;
		background: var(--surface);
		border: 1px solid var(--border);
		cursor: pointer;
	}

	main :global(.button:hover) {
		background: rgb(255 255 255 / 0.14);
	}

	main :global(.button.primary) {
		color: #111;
		background: #eee;
		border-color: transparent;
	}

	main :global(.button.primary:hover) {
		background: #fff;
	}

	main :global(.muted) {
		color: rgb(255 255 255 / 0.6);
	}

	/* A grid of links, each a card with a title, a line below it and an arrow. */
	main :global(.cards) {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
		gap: 12px;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	main :global(.card) {
		height: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 18px;
		color: inherit;
		text-decoration: none;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		transition: background 0.15s;
	}

	main :global(.card:hover) {
		background: rgb(255 255 255 / 0.13);
	}

	main :global(.card .text) {
		flex: 1;
		min-width: 0;
	}

	main :global(.card .title) {
		font-family: var(--lyric-font);
		font-size: 19px;
		font-weight: 600;
		line-height: 1.25;
	}

	main :global(.card .sub) {
		font-size: 14px;
		color: rgb(255 255 255 / 0.6);
	}

	main :global(.card .arrow) {
		flex: none;
		width: 16px;
		height: 16px;
		fill: none;
		stroke: rgb(255 255 255 / 0.5);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>

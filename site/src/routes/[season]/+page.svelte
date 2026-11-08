<script lang="ts">
	import { resolve } from '$app/paths';
	import { install } from '#lib/install.svelte.ts';
	import { saveOffline } from '#lib/offline.ts';
	import Page from '#lib/Page.svelte';
	import { savedOffline } from '#lib/pieces.ts';

	let { data } = $props();

	// Saving for offline use needs the service worker, which needs a secure context.
	const canSave = 'serviceWorker' in navigator;
	let saved = $state(savedOffline());
	const offline = $derived(saved.includes(data.season));
	/** Per season being saved, how far it got, or why it failed. */
	let progress: Record<string, string> = $state({});
	const saving = $derived(progress[data.season]);

	async function save() {
		const { season } = data;
		try {
			await saveOffline(
				season,
				(done, total) => (progress[season] = `Saving… ${done} of ${total}`)
			);
			// Otherwise the browser may delete the files when it runs short of space.
			await navigator.storage.persist();
			delete progress[season];
		} catch (e) {
			progress[season] = `Couldn’t save it: ${(e as Error).message}`;
		}
		saved = savedOffline();
	}

	/** A label such as "Seasons (Gjeilo)" as its title and the part in parentheses. */
	const split = (label: string) => {
		const m = label.match(/^(.*\S)\s*\(([^)]*)\)$/);
		return m ? [m[1], m[2]] : [label, ''];
	};
</script>

<svelte:head><title>{data.title}</title></svelte:head>

<Page>
	<div class="intro">
		<h1>{data.title}</h1>
		<p class="muted">
			{data.pieces.length === 1 ? '1 piece' : `${data.pieces.length} pieces`} · Pick one to practice
		</p>
	</div>

	{#if !install.standalone && !install.dismissed && install.touch && data.season !== 'demo'}
		<div class="note">
			<p>
				To find this music again later,
				{#if install.prompt}
					install it as an app.
				{:else if install.safari}
					add it to your Home Screen: tap Share, then “Add to Home Screen”.
				{:else}
					add this page to your home screen from the browser’s menu.
				{/if}
			</p>
			<div class="note-actions">
				{#if install.prompt}
					<button class="button primary" onclick={() => install.prompt?.prompt()}>Install</button>
				{/if}
				<button class="button" onclick={() => install.dismiss()}>Not now</button>
			</div>
		</div>
	{/if}

	<ul class="cards pieces">
		{#each data.pieces as entry (entry.slug)}
			{@const [title, sub] = split(entry.label)}
			<li>
				<a
					class="card"
					style:--piece-hue={entry.hues?.[0]?.[1] ?? 215}
					href={resolve('/[season]/[slug]/[[view=view]]', {
						season: data.season,
						slug: entry.slug
					})}
				>
					<div class="text">
						<div class="title">{title}</div>
						{#if sub}<div class="sub">{sub}</div>{/if}
					</div>
					<svg class="arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
				</a>
			</li>
		{/each}
	</ul>

	{#if canSave}
		<section class="offline">
			<h2>Practice offline</h2>
			<p class="muted">
				{#if saving}
					{saving}
				{:else if offline}
					All of these pieces are saved on this device, so they play without a connection.
				{:else}
					Save all of these pieces on this device, so they play without a connection.
				{/if}
			</p>
			{#if !saving || saving.startsWith('Couldn’t')}
				<button class="button" onclick={save}>{offline ? 'Update' : 'Save for offline use'}</button>
			{/if}
		</section>
	{/if}
</Page>

<style>
	.intro {
		padding: 6vh 0 28px;
	}

	h1 {
		font-size: clamp(32px, 5vw, 48px);
		margin: 0 0 6px;
	}

	.intro p {
		margin: 0;
		font-size: 17px;
	}

	.note {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px 20px;
		margin-bottom: 24px;
		padding: 14px 18px;
		background: hsl(215 40% 25% / 0.5);
		border: 1px solid var(--border);
		border-radius: 14px;
	}

	.note p {
		flex: 1 1 260px;
		margin: 0;
	}

	.note-actions {
		display: flex;
		gap: 8px;
	}

	.pieces .card {
		/* A stripe in the piece's background hue in the player. */
		background:
			linear-gradient(to right, hsl(var(--piece-hue) 70% 65%) 4px, transparent 4px),
			linear-gradient(to right, hsl(var(--piece-hue) 45% 30% / 0.35), var(--surface) 60%);
		min-height: 72px;
	}

	.pieces .card:hover {
		background:
			linear-gradient(to right, hsl(var(--piece-hue) 70% 65%) 4px, transparent 4px),
			linear-gradient(to right, hsl(var(--piece-hue) 45% 30% / 0.55), rgb(255 255 255 / 0.13) 60%);
	}

	.offline p {
		margin: 0 0 14px;
		max-width: 34em;
	}
</style>

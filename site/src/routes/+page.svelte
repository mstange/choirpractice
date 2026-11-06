<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { saveOffline } from '#lib/offline.ts';
	import { loadSeason, savedOffline } from '#lib/pieces.ts';

	let { data } = $props();

	// Saving for offline use needs the service worker, which needs a secure context.
	const canSave = 'serviceWorker' in navigator;
	let offline = $state(savedOffline());
	/** Per season being saved, how far it got, or why it failed. */
	let saving: Record<string, string> = $state({});

	async function save(season: string) {
		try {
			await saveOffline(season, (done, total) => (saving[season] = `Saving… ${done} of ${total}`));
			// Otherwise the browser may delete the files when it runs short of space.
			await navigator.storage.persist();
			delete saving[season];
		} catch (e) {
			saving[season] = `Couldn’t save it: ${(e as Error).message}`;
		}
		offline = savedOffline();
	}

	let link = $state('');
	let problem = $state('');

	/** Opens the season of a pasted link, or of a key on its own. */
	async function open(event: SubmitEvent) {
		event.preventDefault();
		const text = link.trim();
		const season = (text.includes('#/') ? text.split('#/')[1] : text).split('/')[0];
		if (!season) return;
		problem = '';
		try {
			if (!(await loadSeason(season, fetch))) {
				problem = 'This key doesn’t lead anywhere. Ask your choir for the current link.';
				return;
			}
		} catch {
			problem = 'The music couldn’t be loaded. Are you online?';
			return;
		}
		goto(resolve('/[season]', { season }));
	}
</script>

<svelte:head><title>Choir player</title></svelte:head>

<main>
	<h1>Choir player</h1>
	<p>
		Plays a choir piece with each part’s notes and lyrics. Open it with the link your choir gave
		you.
	</p>

	{#each data.seasons as { season, loaded } (season)}
		<section>
			{#if loaded}
				<h2>{loaded.title}</h2>
				<ul>
					{#each loaded.pieces as entry (entry.slug)}
						<li>
							<a href={resolve('/[season]/[slug]/[[view=view]]', { season, slug: entry.slug })}
								>{entry.label}</a
							>
						</li>
					{/each}
				</ul>
				{#if canSave}
					<p class="offline">
						{#if saving[season]}
							{saving[season]}
						{:else if offline.includes(season)}
							Saved for offline use. <button onclick={() => save(season)}>Update</button>
						{:else}
							<button onclick={() => save(season)}>Save for offline use</button>
						{/if}
					</p>
				{/if}
			{:else}
				<p>
					The pieces of <a href={resolve('/[season]', { season })}>a season you opened before</a>
					couldn’t be loaded.
				</p>
			{/if}
		</section>
	{/each}

	<form onsubmit={open}>
		<label for="link">Link or key from your choir</label>
		<div>
			<input
				id="link"
				bind:value={link}
				autocomplete="off"
				autocapitalize="off"
				spellcheck="false"
			/>
			<button>Open</button>
		</div>
		{#if problem}<p class="problem">{problem}</p>{/if}
	</form>

	<p>
		Try it with <a href={resolve('/[season]', { season: 'demo' })}>Frère Jacques</a>, a round in
		four parts, or with Mozart’s
		<a
			href={resolve('/[season]/[slug]/[[view=view]]', { season: 'demo', slug: 'ave-verum-corpus' })}
			>Ave verum corpus</a
		> for choir and piano.
	</p>
</main>

<style>
	a {
		color: inherit;
	}

	main {
		max-width: 36em;
		margin: 0 auto;
		padding: 15vh 1em;
		/* The body doesn't scroll, for the player's sake. */
		height: 100%;
		overflow-y: auto;
	}

	h2 {
		margin: 0.6em 0 0;
		font-size: 1.1em;
	}

	section {
		margin: 1.5em 0;
		padding: 0.25em 1em;
		background: var(--surface);
		border-radius: 6px;
	}

	ul {
		padding-left: 1.2em;
	}

	li {
		margin: 0.3em 0;
		font-size: 1.15em;
	}

	.offline {
		color: #aaa;
	}

	form {
		margin: 1.5em 0;
	}

	form div {
		display: flex;
		gap: 0.5em;
		margin-top: 0.3em;
	}

	input {
		flex: 1;
		min-width: 0;
		font: inherit;
		padding: 0.3em 0.5em;
	}

	button {
		font: inherit;
	}

	.problem {
		color: #f99;
	}
</style>

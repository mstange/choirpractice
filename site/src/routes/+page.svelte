<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Page from '#lib/Page.svelte';
	import PitchArt from '#lib/PitchArt.svelte';
	import { loadSeason, savedOffline } from '#lib/pieces.ts';

	let { data } = $props();

	const offline = savedOffline();
	let link = $state('');
	let problem = $state('');
	let input: HTMLInputElement;

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

	const FEATURES = [
		[
			'Your part up front',
			'Pick the parts you sing. They play louder than the rest, and “Just me” turns the others down further.'
		],
		[
			'Notes and words',
			'Watch the pitch of every note go by, or read along with the lyrics, with the sheet music below.'
		],
		[
			'At your own speed',
			'Slow down without changing the pitch, and loop the measures you’re working on.'
		],
		[
			'Sing along',
			'Turn on the microphone to see the pitch you sing right on top of the notes. Best with headphones.'
		]
	];

	const arrow = 'M6 3l5 5-5 5';
</script>

<svelte:head><title>Choir player</title></svelte:head>

<Page>
	<div class="home">
		<div class="hero">
			<div class="pitch">
				<h1>Practice your part with the whole choir</h1>
				<p class="lead muted">
					Hear the piece with your part up front, follow its notes and words as they go by, and slow
					down the tricky bits. On your computer or your phone.
				</p>
				<div class="actions">
					{#if data.seasons.length === 0}
						<button class="button primary" onclick={() => input.focus()}
							>Open your choir’s link</button
						>
					{/if}
					<a
						class="button"
						href={resolve('/[season]/[slug]/[[view=view]]', {
							season: 'demo',
							slug: 'frere-jacques'
						})}>Try the demo</a
					>
				</div>
			</div>
			<div class="art"><PitchArt /></div>
		</div>

		{#if data.seasons.length}
			<section class="yours">
				<h2>Your music</h2>
				<ul class="cards">
					{#each data.seasons as { season, loaded } (season)}
						<li>
							<a class="card" href={resolve('/[season]', { season })}>
								<div class="text">
									{#if loaded}
										<div class="title">{loaded.title}</div>
										<div class="sub">
											{loaded.pieces.length === 1 ? '1 piece' : `${loaded.pieces.length} pieces`}
											{#if offline.includes(season)}· saved for offline use{/if}
										</div>
									{:else}
										<div class="title">A season you opened before</div>
										<div class="sub">Couldn’t be loaded just now</div>
									{/if}
								</div>
								<svg class="arrow" viewBox="0 0 16 16" aria-hidden="true"><path d={arrow} /></svg>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section>
			<form onsubmit={open}>
				<label for="link"
					><h2>{data.seasons.length ? 'Got a new link?' : 'Got a link from your choir?'}</h2></label
				>
				<p class="muted">
					Open it, or paste it here. The music you open is listed on this page afterwards.
				</p>
				<div class="field">
					<input
						id="link"
						bind:this={input}
						bind:value={link}
						placeholder="https://choirpractice.app/#/…"
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
					/>
					<button class="button primary">Open</button>
				</div>
				{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
			</form>
		</section>

		<section>
			<h2>What it does</h2>
			<ul class="features">
				{#each FEATURES as [title, text] (title)}
					<li>
						<h3>{title}</h3>
						<p class="muted">{text}</p>
					</li>
				{/each}
			</ul>
		</section>

		<section>
			<h2>Try it out</h2>
			<ul class="cards">
				<li>
					<a
						class="card"
						href={resolve('/[season]/[slug]/[[view=view]]', {
							season: 'demo',
							slug: 'frere-jacques'
						})}
					>
						<div class="text">
							<div class="title">Frère Jacques</div>
							<div class="sub">A round in four parts</div>
						</div>
						<svg class="arrow" viewBox="0 0 16 16" aria-hidden="true"><path d={arrow} /></svg>
					</a>
				</li>
				<li>
					<a
						class="card"
						href={resolve('/[season]/[slug]/[[view=view]]', {
							season: 'demo',
							slug: 'ave-verum-corpus'
						})}
					>
						<div class="text">
							<div class="title">Ave verum corpus</div>
							<div class="sub">Mozart, for choir and piano</div>
						</div>
						<svg class="arrow" viewBox="0 0 16 16" aria-hidden="true"><path d={arrow} /></svg>
					</a>
				</li>
			</ul>
		</section>
	</div>
</Page>

<style>
	.home {
		display: flex;
		flex-direction: column;
	}

	.hero {
		display: grid;
		grid-template-columns: 1fr 1.1fr;
		align-items: center;
		gap: 40px;
		padding-top: 6vh;
	}

	h1 {
		font-size: clamp(34px, 5vw, 52px);
		margin: 0 0 16px;
	}

	.lead {
		font-size: 18px;
		margin: 0 0 28px;
		max-width: 30em;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.art {
		height: 320px;
		border-radius: 18px;
		overflow: hidden;
		background: rgb(0 0 0 / 0.25);
		border: 1px solid var(--border);
	}

	form {
		max-width: 560px;
	}

	label h2 {
		margin-bottom: 4px;
	}

	form p {
		margin: 0 0 12px;
	}

	.field {
		display: flex;
		gap: 8px;
	}

	input {
		flex: 1;
		min-width: 0;
		min-height: 44px;
		padding: 0 16px;
		font: inherit;
		color: inherit;
		background: rgb(0 0 0 / 0.3);
		border: 1px solid var(--border);
		border-radius: 22px;
	}

	input:focus-visible {
		outline: 2px solid #eee;
		outline-offset: 1px;
	}

	.problem {
		margin-top: 10px;
		color: #f99;
	}

	.features {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
		gap: 24px;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	h3 {
		margin: 0 0 4px;
		font-size: 16px;
	}

	.features p {
		margin: 0;
		font-size: 15px;
	}

	@media (max-width: 760px) {
		.hero {
			grid-template-columns: 1fr;
			gap: 28px;
			padding-top: 2vh;
		}

		.lead {
			font-size: 17px;
		}

		.art {
			height: 240px;
		}

		/* Someone coming back finds their music first. */
		.yours {
			order: -1;
			margin: 2vh 0 0;
		}

		.home:has(.yours) .hero {
			padding-top: 44px;
		}
	}
</style>

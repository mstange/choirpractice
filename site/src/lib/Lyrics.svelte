<script lang="ts">
	import { splitLines, startsWord, type Line } from './lyrics.ts';
	import type { Syllable, Voice } from './types.ts';

	let {
		voices,
		colors,
		selected,
		t,
		onseek
	}: {
		voices: Voice[];
		colors: Record<string, string>;
		selected: Set<string>;
		t: number;
		onseek: (t: number) => void;
	} = $props();

	// Bouncing ball: one per selected part. It hops from syllable to syllable and lands on each
	// syllable as it starts, including the first syllable of the next line. Hops are at most
	// MAX_HOP long, so the ball waits on long syllables instead of floating slowly. After rests of
	// at least ENTRY_GAP, it fades out and drops in again before the entry.
	//
	// While it waits on a held syllable, the ball slides along it. While a note is sounding, it
	// leaves a trail of puffs that drift to the left. It pulses at the start of every note.
	const MAX_HOP = 0.3;
	const ENTRY_GAP = 1.5;
	const FADE = 0.3;
	const LINGER = 0.1; // seconds a line stays current after its last syllable before a long rest
	const MAX_SLIDE = 0.35; // fraction of the syllable's width on either side of its middle
	const SWELL = 0.08; // the pulse peaks at the note start
	const SHRINK = 0.25;
	const PUFF_EVERY = 1 / 40; // puffs are emitted at fixed times, so the trail freezes on pause
	const PUFF_LIFE = 0.8;
	const PUFFS = Math.ceil(PUFF_LIFE / PUFF_EVERY) + 2;

	// A landing on syllable i of a line.
	interface Landing {
		t: number;
		line: number;
		i: number;
	}

	// How the ball slides on a syllable: from t0 to t1, by `spread` on either side of its middle.
	// The syllable is sung until `end`.
	interface Hold {
		t0: number;
		t1: number;
		spread: number;
		end: number;
	}

	type Row = ReturnType<typeof makeRow>;

	function makeRow(v: Voice) {
		const lines = splitLines(v.syllables);
		// The lines hold all syllables in order, so lands[k] is v.syllables[k].
		const lands: Landing[] = lines.flatMap((l, line) =>
			l.sylls.map((s, i) => ({ t: s.t0, line, i }))
		);
		// When each line becomes current. After a long rest that's right after the previous line
		// ends, so that singers can read ahead. Otherwise it's when the ball leaves for the line, so
		// that the ball jumps into the line it lands on.
		const switches = lines.map((l, j) => {
			if (j === 0) return -Infinity;
			const prev = lines[j - 1];
			if (l.t0 - prev.t1 >= ENTRY_GAP) return prev.t1 + LINGER;
			return Math.max(prev.sylls.at(-1)!.t0, l.t0 - MAX_HOP);
		});
		// The ball slides while the syllable is sung and it isn't hopping yet.
		const holds: Hold[] = v.syllables.map((s, k) => {
			const next = v.syllables[k + 1];
			const t1 = Math.min(s.t1, next ? Math.max(s.t0, next.t0 - MAX_HOP) : s.t1);
			return { t0: s.t0, t1, spread: MAX_SLIDE * clamp01((t1 - s.t0 - 0.2) / 0.8), end: s.t1 };
		});
		// The start of every note. Tied notes are already merged into one.
		const pulses = v.notes.filter((n) => n.s >= 0).map((n) => n.t0);
		return { name: v.name, lines, lands, switches, holds, pulses };
	}

	const rows = $derived(voices.map(makeRow));
	const dominantRows = $derived(voices.filter((v) => selected.has(v.name)).length);

	const currentLine = (r: Row, t: number) => r.switches.findLastIndex((s) => s <= t);

	// Entry cue: a bar under the voice name that fills up during the two seconds before an entry.
	function cue(lines: Line[], cur: number, t: number) {
		const until = lines[cur].t0 - t;
		const rest = lines[cur].t0 - (lines[cur - 1]?.t1 ?? 0);
		return until > 0 && until < 2 && rest > 2 ? 1 - until / 2 : 0;
	}

	// Only the current and the previous line are partially sung; every other line gets a
	// constant time so that its syllables don't update on every frame.
	const lineTime = (i: number, cur: number, t: number) =>
		i < cur - 1 ? Infinity : i > cur ? -Infinity : t;

	const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

	// Where the slide along a syllable is at time t, from -1 to 1.
	const slide = (h: Hold, t: number) =>
		h.t1 > h.t0 ? 2 * clamp01((t - h.t0) / (h.t1 - h.t0)) - 1 : 1;

	// Positions are measured from the rendered syllables on every frame, so the ball follows the
	// lines while they slide and scale between their slots. The exception is the last syllable of a
	// line that is sliding away: the ball takes off from it, or fades out on it, at the position
	// where it was when its line started to leave. That position is remembered in `frozen`.
	//
	// The ball and its puffs are in a layer over the whole row rather than in the clipped .lines,
	// because crowded rows shrink and leave no room for the hops. The ball can fly over the row
	// above.
	type Rect = { x: number; y: number; h: number; w: number };
	type Frozen = Rect & { k: number };
	function placeBall(layer: HTMLElement, r: Row, t: number, frozen: Frozen) {
		const puffs = [...layer.children] as HTMLElement[];
		const ball = puffs.pop()!; // last, so that it's drawn over its puffs
		const box = layer.getBoundingClientRect();
		const lineEls = layer.parentElement!.querySelectorAll('.line');
		const { lands, lines, holds } = r;
		const rects = new Map<number, Rect>();
		const measure = (k: number): Rect => {
			let rect = rects.get(k);
			if (!rect) {
				const l = lands[k];
				const s = lineEls[l.line].querySelectorAll('.syl')[l.i].getBoundingClientRect();
				rect = { x: s.left - box.left + s.width / 2, y: s.top - box.top, h: s.height, w: s.width };
				rects.set(k, rect);
			}
			return rect;
		};
		// The ball on syllable k at time t.
		const on = (k: number, t: number, rect = measure(k)) => ({
			...rect,
			x: rect.x + rect.w * holds[k].spread * slide(holds[k], t)
		});

		// Where the ball is at time `at`. Only the present may freeze a new position; past
		// positions, for the puffs, reuse it if it's for the same syllable.
		function ballAt(at: number, live: boolean) {
			const freeze = (k: number) => {
				if (frozen.k === k) return frozen;
				if (!live) return measure(k);
				return Object.assign(frozen, { k, ...measure(k) });
			};
			const k = lands.findLastIndex((l) => l.t <= at);
			const prev = lands[k],
				next = lands[k + 1];
			if (!next) return { k, ...on(k, at), lift: 0, opacity: 1 };
			const entry =
				!prev ||
				(next.line !== prev.line && lines[next.line].t0 - lines[prev.line].t1 >= ENTRY_GAP);
			const t0 = Math.max(prev?.t ?? -Infinity, next.t - MAX_HOP);
			if (entry && at < t0) {
				// Before an entry: stay on the last syllable until its line leaves, then fade out.
				if (!prev) return { k, ...on(k + 1, next.t), lift: 0, opacity: 0 };
				const leave = r.switches[next.line];
				if (at < leave) return { k, ...on(k, at), lift: 0, opacity: 1 };
				return { k, ...on(k, at, freeze(k)), lift: 0, opacity: clamp01(1 - (at - leave) / FADE) };
			}
			if (at < t0) return { k, ...on(k, at), lift: 0, opacity: 1 };
			const to = on(k + 1, next.t);
			let from;
			if (entry) from = { ...to, x: to.x - to.h };
			else if (prev.line === next.line) from = on(k, at);
			else from = on(k, at, freeze(k));
			const d = next.t - t0;
			const u = d > 0 ? clamp01((at - t0) / d) : 1;
			return {
				k,
				x: from.x + (to.x - from.x) * u,
				y: from.y + (to.y - from.y) * u,
				h: from.h + (to.h - from.h) * u,
				lift: 4 * u * (1 - u) * 0.65 * Math.sqrt(Math.min(1, d / MAX_HOP)),
				opacity: entry ? u : 1
			};
		}

		const p = ballAt(t, true);
		// Pulse: a quick swell up to each note start, then a slower decay. Notes can be closer
		// together than a whole pulse, so the biggest of the overlapping pulses wins.
		let swell = 0;
		const first = r.pulses.findIndex((tp) => tp > t - SHRINK);
		for (let i = first; i >= 0 && r.pulses[i] < t + SWELL; i++) {
			const d = t - r.pulses[i];
			swell = Math.max(swell, d < 0 ? 1 + d / SWELL : (1 - d / SHRINK) ** 2);
		}
		const scale = 1 + 0.9 * swell;
		ball.style.transform = `translate(calc(${p.x}px - 50%), calc(${p.y - p.lift * p.h}px - 100%)) scale(${scale})`;
		ball.style.opacity = String(p.opacity);

		// Puffs, emitted wherever the ball was during the last PUFF_LIFE seconds while a note was
		// sounding. They are placed relative to the current layout, so they move along with the lines.
		let n = 0;
		for (let i = Math.floor(t / PUFF_EVERY); n < puffs.length; i--) {
			const te = i * PUFF_EVERY,
				a = (t - te) / PUFF_LIFE;
			if (a >= 1) break;
			const k = lands.findLastIndex((l) => l.t <= te);
			if (k < 0 || te >= holds[k].end) continue;
			const q = ballAt(te, false);
			// Fast flights, like the jump to the next line, would leave a string of separate dots.
			const was = ballAt(te - PUFF_EVERY, false);
			const speed = Math.hypot(q.x - was.x, q.y - q.lift * q.h - was.y + was.lift * was.h);
			const thin = clamp01(2 - speed / PUFF_EVERY / q.h / 6);
			const dx = -q.h * (0.5 * a + 1.2 * a * a);
			const dy = -q.h * (q.lift + 0.25 * a + 0.05 * Math.sin(i * 2.3 + a * 9));
			const puff = puffs[n++];
			puff.style.transform = `translate(calc(${q.x + dx}px - 50%), calc(${q.y + dy}px - 100%)) scale(${1.6 - 0.9 * a})`;
			puff.style.opacity = String(0.6 * (1 - a) ** 1.5 * q.opacity * thin);
		}
		for (; n < puffs.length; n++) puffs[n].style.opacity = '0';
	}

	// The ball runs its own animation loop so that it also follows the lines' transitions while
	// playback is paused.
	const ballLoop = (r: Row) => (layer: HTMLElement) => {
		const frozen = { k: -1, x: 0, y: 0, h: 0, w: 0 };
		let raf = requestAnimationFrame(function frame() {
			placeBall(layer, r, t, frozen);
			raf = requestAnimationFrame(frame);
		});
		return () => cancelAnimationFrame(raf);
	};

	const progress = (s: Syllable, t: number) =>
		Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0)));
</script>

{#snippet line(sylls: Syllable[], t: number)}
	{#each sylls as s, i}{#if i > 0 && startsWord(sylls, i)}{' '}{/if}<span
			class="syl"
			style:--p={progress(s, t)}
			onclick={() => onseek(s.t0 - 1.2)}
			role="presentation">{s.text}</span
		>{/each}
{/snippet}

<div
	class="stage"
	class:multi={selected.size > 1}
	style:--dominant-rows={dominantRows}
	style:--other-rows={voices.length - dominantRows}
>
	{#each rows as row (row.name)}
		{@const cur = currentLine(row, t)}
		<div class="row" class:dominant={selected.has(row.name)} style:--c={colors[row.name]}>
			<div class="label" style:--cue={cue(row.lines, cur, t)}>{row.name}</div>
			<div class="lines">
				{#each row.lines as l, i}
					<div
						class="line"
						class:past={i < cur}
						class:current={i === cur}
						class:future={i > cur}
						class:next={i === cur + 1}
					>
						{@render line(l.sylls, lineTime(i, cur, t))}
					</div>
				{/each}
			</div>
			{#if selected.has(row.name)}
				<div class="ball-layer" {@attach ballLoop(row)}>
					{#each { length: PUFFS }}<div class="ball puff"></div>{/each}
					<div class="ball"></div>
				</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	/* Rows are sized in units of --u, which is 1vh unless that would make the rows overflow the
	   stage. Then everything shrinks to fit. */
	.stage {
		--dominant-size: 6.2;
		--dominant-lines: 2.6;
		--ball-room: 0.8;
		--other-size: 3.2;
		--other-lines: 1.9;
		--gap: 1.2;
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		min-height: 0;
		container-type: size;
	}
	.stage.multi {
		--dominant-size: 4.4;
		--dominant-lines: 1.9;
		/* The ball may fly over the bottom of the row above. */
		--ball-room: 0.3;
	}

	.row {
		--u: min(
			1vh,
			100cqh /
				(
					var(--dominant-rows) * var(--dominant-size) * (var(--dominant-lines) + var(--ball-room)) +
						var(--other-rows) * var(--other-size) * var(--other-lines) +
						(var(--dominant-rows) + var(--other-rows) - 1) * var(--gap)
				)
		);
		--size: calc(var(--other-size) * var(--u));
		position: relative;
		display: grid;
		grid-template-columns: 7em 1fr;
		align-items: center;
		height: calc(var(--size) * var(--other-lines));
		transition:
			height 0.4s,
			opacity 0.4s;
		opacity: 0.7;
	}
	.row + .row {
		margin-top: calc(var(--gap) * var(--u));
	}
	/* Dominant rows get extra room above the lines for the bouncing ball. */
	.row.dominant {
		--size: calc(var(--dominant-size) * var(--u));
		height: calc(var(--size) * (var(--dominant-lines) + var(--ball-room)));
		opacity: 1;
	}
	.row.dominant .label {
		margin-top: calc(var(--size) * var(--ball-room));
	}
	.row.dominant .line {
		top: calc(50% + var(--size) * var(--ball-room) / 2);
	}

	.label {
		position: relative;
		color: var(--c);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 12px;
		padding-bottom: 6px;
	}
	.label::after {
		content: '';
		position: absolute;
		left: 0;
		bottom: 0;
		height: 3px;
		width: calc(var(--cue, 0) * 5em);
		background: var(--c);
		border-radius: 2px;
	}

	.lines {
		position: relative;
		height: 100%;
		overflow: hidden;
	}

	.line {
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		white-space: nowrap;
		font: 500 var(--size) / 1.1 var(--lyric-font);
		transform: translateY(-50%);
		transition:
			transform 0.45s ease,
			opacity 0.45s ease,
			font-size 0.4s;
		opacity: 0;
		pointer-events: none;
	}
	.line.current {
		opacity: 1;
		pointer-events: auto;
	}
	.line.past {
		transform: translateY(-160%);
	}
	.line.future {
		transform: translateY(80%);
	}
	.stage:not(.multi) .row.dominant .line.current {
		transform: translateY(-95%);
	}
	.stage:not(.multi) .row.dominant .line.next {
		opacity: 0.55;
		transform: translateY(5%) scale(0.62);
		transform-origin: left center;
		pointer-events: auto;
	}

	.ball-layer {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: none;
	}
	.ball {
		position: absolute;
		left: 0;
		top: 0;
		width: calc(var(--size) * 0.2);
		height: calc(var(--size) * 0.2);
		border-radius: 50%;
		background: var(--c);
		box-shadow: 0 0 calc(var(--size) * 0.25) var(--c);
	}
	.ball.puff {
		opacity: 0;
		background: radial-gradient(closest-side, var(--c), transparent);
		box-shadow: none;
	}

	.syl {
		--p: 0;
		cursor: pointer;
		color: transparent;
		background: linear-gradient(
			90deg,
			var(--c) calc(var(--p) * 100%),
			var(--dim) calc(var(--p) * 100%)
		);
		background-clip: text;
	}
</style>

<script lang="ts">
	// A still of the Pitch view for the start page: the demo's Frère Jacques, a round in four parts,
	// with the soprano selected and a mic trail. The SVG covers its box, cropped around the "now"
	// line, so a narrow box shows less time rather than smaller text.

	// The melody as [MIDI pitch, beats], one syllable per note.
	const MELODY: [number, number][] = [
		...[
			[62, 1],
			[64, 1],
			[66, 1],
			[62, 1]
		],
		...[
			[62, 1],
			[64, 1],
			[66, 1],
			[62, 1]
		],
		...[
			[66, 1],
			[67, 1],
			[69, 2],
			[66, 1],
			[67, 1],
			[69, 2]
		],
		...[
			[69, 0.5],
			[71, 0.5],
			[69, 0.5],
			[67, 0.5],
			[66, 1],
			[62, 1]
		],
		...[
			[69, 0.5],
			[71, 0.5],
			[69, 0.5],
			[67, 0.5],
			[66, 1],
			[62, 1]
		],
		...[
			[62, 1],
			[57, 1],
			[62, 2],
			[62, 1],
			[57, 1],
			[62, 2]
		]
	] as [number, number][];
	const LYRICS = (
		'Frè re Jac ques, frè re Jac ques, dor mez vous? dor mez vous? ' +
		'Son nez les ma ti nes, son nez les ma ti nes, ding, dang, dong. ding, dang, dong.'
	).split(' ');
	// Each part enters two measures after the one before; the men sing an octave lower.
	const PARTS = [
		{ color: '#ff7a9c', start: 0, shift: 0 },
		{ color: '#ffb84d', start: 8, shift: 0 },
		{ color: '#5fe0a8', start: 16, shift: -12 },
		{ color: '#6fb0ff', start: 24, shift: -12 }
	];

	const BEAT = 44; // px
	const NOW = 30; // beats
	const [FROM, TO] = [NOW - 11, NOW + 11];
	const SEMITONE = 9; // px
	const [LOW, HIGH] = [44, 74]; // MIDI pitches at the bottom and top
	const W = (TO - FROM) * BEAT;
	const H = (HIGH - LOW) * SEMITONE + 40;
	const x = (beat: number) => (beat - FROM) * BEAT;
	const y = (pitch: number) => 28 + (HIGH - pitch) * SEMITONE;

	const notes = PARTS.flatMap((part, i) => {
		let beat = part.start;
		// Twice through the melody.
		return [...MELODY, ...MELODY].map(([pitch, beats], n) => {
			const note = {
				part: i,
				color: part.color,
				t0: beat,
				t1: beat + beats,
				p: pitch + part.shift,
				text: LYRICS[n % LYRICS.length]
			};
			beat += beats;
			return note;
		});
	}).filter((n) => n.t1 > FROM && n.t0 < TO);
	const soprano = notes.filter((n) => n.part === 0);

	// What the singer sang over the last few beats: the soprano's notes, a little off and wavering.
	const trail = soprano
		.filter((n) => n.t1 > NOW - 5 && n.t0 < NOW)
		.flatMap((n) => {
			const points = [];
			for (let b = Math.max(n.t0, NOW - 5) + 0.06; b < Math.min(n.t1, NOW) - 0.04; b += 0.1)
				points.push(`${x(b).toFixed(1)},${(y(n.p) + 4 + 2.2 * Math.sin(b * 9)).toFixed(1)}`);
			return points.length ? [points.join(' ')] : [];
		});
	const sung = soprano.find((n) => n.t0 <= NOW && NOW < n.t1);
</script>

<svg
	viewBox="0 0 {W} {H}"
	preserveAspectRatio="xMidYMid slice"
	role="img"
	aria-label="The Pitch view: each part's notes as bars, and the words of the selected part"
>
	<!-- The C of each octave, and measure lines. -->
	{#each [48, 60, 72] as p (p)}
		<line class="grid" x1="0" x2={W} y1={y(p) + 4} y2={y(p) + 4} />
	{/each}
	{#each { length: (TO - FROM) / 4 + 1 } as _, i (i)}
		{@const beat = Math.ceil(FROM / 4) * 4 + i * 4}
		<line class="grid" x1={x(beat)} x2={x(beat)} y1="0" y2={H} />
		<text class="measure" x={x(beat) + 5} y="16">{beat / 4 + 1}</text>
	{/each}

	{#each notes as n, i (i)}
		{@const past = n.t1 <= NOW}
		{#if n.part === 0}
			<rect
				x={x(n.t0) + 1}
				y={y(n.p)}
				width={(n.t1 - n.t0) * BEAT - 2}
				height="8"
				rx="4"
				fill={n.color}
				opacity={past ? 0.45 : 1}
				class:glow={n === sung}
			/>
			<text class="lyric" x={x(n.t0) + 2} y={y(n.p) + 24} opacity={past ? 0.45 : 1}>{n.text}</text>
		{:else}
			<rect
				x={x(n.t0) + 1.5}
				y={y(n.p) + 0.5}
				width={(n.t1 - n.t0) * BEAT - 3}
				height="7"
				rx="3.5"
				fill="none"
				stroke={n.color}
				stroke-width="1.5"
				opacity={past ? 0.25 : 0.55}
			/>
		{/if}
	{/each}

	{#each trail as points, i (i)}
		<polyline class="trail" {points} />
	{/each}
	<line class="now" x1={x(NOW)} x2={x(NOW)} y1="0" y2={H} />
	{#if sung}<circle class="marker" cx={x(NOW)} cy={y(sung.p) + 4} r="5" />{/if}
</svg>

<style>
	svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	.grid {
		stroke: rgb(255 255 255 / 0.08);
	}

	.measure {
		font:
			12px system-ui,
			sans-serif;
		fill: rgb(255 255 255 / 0.35);
	}

	.lyric {
		font: 15px var(--lyric-font);
		fill: #eee;
	}

	.glow {
		filter: drop-shadow(0 0 6px #ff7a9c);
	}

	.trail {
		fill: none;
		stroke: #fff;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0.7;
	}

	.now {
		stroke: rgb(255 255 255 / 0.8);
		stroke-width: 2;
	}

	.marker {
		fill: #fff;
	}
</style>

import type { Voice } from './types.ts';

// Colors per voice type; divided sections (Alto 1, Alto 2, ...) take the next color of their type.
const VOICE_COLORS: Record<string, string[]> = {
	soprano: ['#ff7a9c', '#ff9ee0'],
	alto: ['#ffb84d', '#efe05a'],
	tenor: ['#5fe0a8', '#45d0e6'],
	bass: ['#6fb0ff', '#a99cff']
};
const FALLBACK_COLORS = ['#ff7a9c', '#ffb84d', '#5fe0a8', '#6fb0ff', '#c58cff', '#efe05a'];

export function assignColors(voices: Voice[]): Record<string, string> {
	const colors: Record<string, string> = {};
	const used: Record<string, number> = {};
	voices.forEach((v, i) => {
		const type = Object.keys(VOICE_COLORS).find((t) => v.name.toLowerCase().includes(t));
		if (type) {
			used[type] = (used[type] ?? -1) + 1;
			colors[v.name] = VOICE_COLORS[type][used[type]] ?? VOICE_COLORS[type][0];
		} else {
			colors[v.name] = FALLBACK_COLORS[i % FALLBACK_COLORS.length];
		}
	});
	return colors;
}

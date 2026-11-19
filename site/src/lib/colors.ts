import type { Voice } from './types.ts';

export const norm = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
const TYPES: [RegExp, string][] = [
	[/sop/, 'soprano'],
	[/alt/, 'alto'],
	[/ten/, 'tenor'],
	[/bass|bari/, 'bass']
];
export const voiceType = (name: string) => TYPES.find(([re]) => re.test(norm(name)))?.[1];

// Colors per voice type; divided sections (Soprano 1, 2, 3, ...) take the next color of their
// type, which differs from the others in hue as far as the neighbouring types allow.
const VOICE_COLORS: Record<string, string[]> = {
	soprano: ['#ff6f8e', '#dc8cff', '#ff9a66'],
	alto: ['#ffb84d', '#efe05a', '#c9a36b'],
	tenor: ['#5fe0a8', '#45d0e6', '#a8e05a'],
	bass: ['#6fb0ff', '#a99cff', '#5b78ff']
};
const FALLBACK_COLORS = ['#ff7a9c', '#ffb84d', '#5fe0a8', '#6fb0ff', '#c58cff', '#efe05a'];

export function assignColors(voices: Voice[]): Record<string, string> {
	const colors: Record<string, string> = {};
	const used: Record<string, number> = {};
	voices.forEach((v, i) => {
		const type = voiceType(v.name);
		if (type) {
			const shades = VOICE_COLORS[type];
			used[type] = (used[type] ?? -1) + 1;
			colors[v.name] = shades[used[type] % shades.length];
		} else {
			colors[v.name] = FALLBACK_COLORS[i % FALLBACK_COLORS.length];
		}
	});
	return colors;
}

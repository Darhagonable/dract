export interface DocEntry {
	slug: string;
	title: string;
	group: string;
}

export const docs: DocEntry[] = [
	// Getting Started
	{ slug: 'introduction', title: 'Introduction', group: 'Getting Started' },
	{ slug: 'quick-start', title: 'Quick Start', group: 'Getting Started' },

	// Basics
	{ slug: 'components', title: 'Components', group: 'Basics' },
	{ slug: 'reactivity', title: 'Reactivity', group: 'Basics' },
	{ slug: 'rendering', title: 'Rendering', group: 'Basics' },

	// Templates
	{ slug: 'control-flow', title: 'Control Flow', group: 'Templates' },
	{ slug: 'events', title: 'Event Handlers', group: 'Templates' },
	{ slug: 'bindings', title: 'Bindings', group: 'Templates' },
	{ slug: 'styling', title: 'Styling', group: 'Templates' },

	// Advanced
	{ slug: 'context', title: 'Context', group: 'Advanced' },
	{ slug: 'lifecycle', title: 'Lifecycle Hooks', group: 'Advanced' },

	// Toolkit
	{ slug: 'router', title: 'Router', group: 'Toolkit' },
	{ slug: 'query', title: 'Query', group: 'Toolkit' },

	// Under the Hood
	{ slug: 'how-it-works', title: 'How It Works', group: 'Under the Hood' },
	{ slug: 'comparison', title: 'Comparison', group: 'Under the Hood' },
];

export function getGroups(): { name: string; entries: DocEntry[] }[] {
	const groups: { name: string; entries: DocEntry[] }[] = [];
	const seen = new Set<string>();
	for (const entry of docs) {
		if (!seen.has(entry.group)) {
			seen.add(entry.group);
			groups.push({ name: entry.group, entries: [] });
		}
		groups.find(g => g.name === entry.group)!.entries.push(entry);
	}
	return groups;
}

const modules = import.meta.glob('../content/*.md', { eager: true }) as Record<string, { default: { html: string; title: string; sections: { slug: string; title: string; level: number }[] } }>;

export function getDoc(slug: string) {
	const key = `../content/${slug}.md`;
	const mod = modules[key];
	if (!mod) return null;
	return mod.default;
}

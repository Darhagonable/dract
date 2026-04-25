import type { Plugin } from 'vite';
import { Marked } from 'marked';
import { createHighlighter } from 'shiki';

interface MdModule {
	html: string;
	title: string;
	sections: { slug: string; title: string; level: number }[];
}

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null;

async function getHighlighter() {
	if (!highlighterPromise) {
		highlighterPromise = createHighlighter({
			themes: ['github-dark', 'github-light'],
			langs: ['tsx', 'typescript', 'javascript', 'css', 'html', 'bash', 'json', 'svelte'],
		});
	}
	return highlighterPromise;
}

function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/<[^>]+>/g, '')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function extractFrontmatter(markdown: string): { metadata: Record<string, string>; body: string } {
	const match = /^---\r?\n([\s\S]+?)\r?\n---/.exec(markdown);
	if (!match) return { metadata: {}, body: markdown };

	const body = markdown.slice(match[0].length).trim();
	const metadata: Record<string, string> = {};
	for (const line of match[1].split('\n')) {
		const m = /^(\w+):\s*(.*)$/.exec(line);
		if (m) metadata[m[1]] = m[2].trim();
	}
	return { metadata, body };
}

async function renderMarkdown(source: string): Promise<MdModule> {
	const { metadata, body } = extractFrontmatter(source);
	const hl = await getHighlighter();

	const sections: MdModule['sections'] = [];
	let title = metadata.title || '';

	const marked = new Marked({
		async: true,
		renderer: {
			heading({ text, depth }) {
				const rendered = text.replace(/`([^`]+)`/g, '<code>$1</code>');
				const slug = slugify(text);
				if (depth === 1 && !title) {
					title = text.replace(/`([^`]+)`/g, '$1');
				}
				if (depth === 1) {
					return ''; // Title is rendered by the page header
				}
				if (depth === 2 || depth === 3) {
					sections.push({ slug, title: text.replace(/`([^`]+)`/g, '$1'), level: depth });
				}
				return `<h${depth} id="${slug}"><a class="anchor" href="#${slug}">#</a>${rendered}</h${depth}>`;
			},
			code({ text, lang }) {
				const language = lang || 'text';
				try {
					return `<div class="code-block" data-lang="${language}"><button class="copy-btn" title="Copy">
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
</button>${hl.codeToHtml(text, {
						lang: language as any,
						themes: { light: 'github-light', dark: 'github-dark' },
					})}</div>`;
				} catch {
					return `<div class="code-block"><pre><code>${text}</code></pre></div>`;
				}
			},
			codespan({ text }) {
				return `<code>${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code>`;
			},
		},
	});

	const html = await marked.parse(body);
	return { html: html ?? '', title, sections };
}

export default function markdown(): Plugin {
	return {
		name: 'dartsx-markdown',
		async transform(code, id) {
			if (!id.endsWith('.md')) return null;
			const result = await renderMarkdown(code);
			return {
				code: `export default ${JSON.stringify(result)};`,
				map: null,
			};
		},
	};
}

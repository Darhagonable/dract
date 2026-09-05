import examples from '../examples/meta.json';

const sources = import.meta.glob('../examples/**/App.tsx', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>;

function sourceFor(path: string): string {
	return sources[`../examples${path}/App.tsx`] ?? `// missing example: ${path}`;
}

export default component App() {
	state activeTab = 'preview'

	render (
		<div class="layout">
			<div class="editor" id="editor-mount">
				{for (const group of examples.groups) (
					<section>
						<h2>{group.label}</h2>
						{for (const example of group.examples) (
							<article>
								<h3>{example.label}</h3>
								<pre><code>{sourceFor(example.path)}</code></pre>
							</article>
						)}
					</section>
				)}
			</div>
			<div class="result">
				<div class="result-tabs">
					<button onclick={() => activeTab = 'preview'}>Preview</button>
					<button onclick={() => activeTab = 'output'}>Output</button>
				</div>
				{if (activeTab === 'preview') (
					<div id="preview-mount">preview</div>
				)}
				{if (activeTab === 'output') (
					<div id="output-mount">output</div>
				)}
			</div>
		</div>
		<style>
			.layout { display: flex; }
			.editor, .result { flex: 1; min-width: 0; }
		</style>
	)
}

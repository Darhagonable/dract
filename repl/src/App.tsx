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
	render (
		<main>
			<h1>DarTsx Examples</h1>
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
		</main>
	)
}

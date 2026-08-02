// One-off verification: compiles every example under repl/examples/ through
// the real module-graph pipeline and checks the "new file" scaffold compiles.
// Run: pnpm exec sucrase-node scripts/verify-examples.ts
import { readdirSync, readFileSync } from 'node:fs';
import { buildModuleGraph } from '../src/lib/playground-modules.ts';
import { compilePlayground } from '../src/lib/playground.ts';

const root = new URL('../examples/', import.meta.url);
let failed = 0;
let count = 0;

for (const group of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).sort()) {
	const groupDir = new URL(`${group.name}/`, root);
	for (const ex of readdirSync(groupDir, { withFileTypes: true }).filter((d) => d.isDirectory()).sort()) {
		const exDir = new URL(`${ex.name}/`, groupDir);
		const files = readdirSync(exDir)
			.filter((name) => name.endsWith('.tsx'))
			.sort()
			.map((name) => ({
				name,
				source: readFileSync(new URL(name, exDir), 'utf8'),
			}));
		const meta = JSON.parse(readFileSync(new URL('meta.json', exDir), 'utf8')) as {
			entry?: string;
		};
		const result = await buildModuleGraph(files, meta.entry ?? files[0].name);
		count++;
		if (result.ok) console.log(`ok    ${group.name}/${ex.name}`);
		else {
			failed++;
			console.log(`FAIL  ${group.name}/${ex.name}: ${result.error}`);
		}
	}
}

const scaffold = compilePlayground('// New file — replace this with your code.', 'File.tsx');
if (scaffold.ok) console.log('ok    new-file scaffold (comment-only File.tsx)');
else {
	failed++;
	console.log(`FAIL  new-file scaffold: ${scaffold.error}`);
}

console.log(`\n${count} examples, ${failed} failures`);
process.exit(failed ? 1 : 0);

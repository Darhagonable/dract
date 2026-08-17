// Static dropdown structure — examples grouped into <optgroup>s in
// declaration order. Shared by the toolbar's Examples dropdown.
import * as pgExamples from './playground-examples.ts';

export const EXAMPLE_GROUPS: { group: string; examples: typeof pgExamples.EXAMPLES }[] = [];
for (const example of pgExamples.EXAMPLES) {
	const bucket = EXAMPLE_GROUPS.find((candidate) => candidate.group === example.group);
	if (bucket) bucket.examples.push(example);
	else EXAMPLE_GROUPS.push({ group: example.group, examples: [example] });
}
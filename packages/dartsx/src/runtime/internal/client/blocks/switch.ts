import { effect, collectEffects, disposeEffects, type Effect } from '../reactivity/effect';

export interface SwitchCase {
	values: unknown[] | null;
	fn: () => unknown;
}

export function switch_block(
	discriminantFn: () => unknown,
	cases: SwitchCase[],
): Node {
	const start = document.createComment('');
	const end = document.createComment('');
	const frag = document.createDocumentFragment();
	frag.appendChild(start);
	frag.appendChild(end);

	let currentCaseIndex: number = -1;
	let branchEffects: Effect[] = [];

	effect(() => {
		const value = discriminantFn();

		let matchIndex = -1;
		for (let i = 0; i < cases.length; i++) {
			const c = cases[i];
			if (c.values === null) {
				if (matchIndex === -1) matchIndex = i;
			} else if (c.values.includes(value)) {
				matchIndex = i;
				break;
			}
		}

		if (matchIndex === currentCaseIndex) return;
		currentCaseIndex = matchIndex;

		disposeEffects(branchEffects);
		branchEffects = [];

		while (start.nextSibling !== end) {
			start.nextSibling!.remove();
		}

		if (matchIndex !== -1) {
			const result = collectEffects(() => cases[matchIndex].fn());
			branchEffects = result.effects;
			const node = result.value;
			if (node instanceof Node) {
				end.parentNode!.insertBefore(node, end);
			} else if (node != null && node !== false && node !== true) {
				end.parentNode!.insertBefore(document.createTextNode(String(node)), end);
			}
		}
	});

	return frag;
}

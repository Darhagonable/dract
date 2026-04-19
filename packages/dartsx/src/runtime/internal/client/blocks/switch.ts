import { effect } from '../reactivity/effect';

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

		while (start.nextSibling !== end) {
			start.nextSibling!.remove();
		}

		if (matchIndex !== -1) {
			const result = cases[matchIndex].fn();
			if (result instanceof Node) {
				end.parentNode!.insertBefore(result, end);
			} else if (result != null && result !== false && result !== true) {
				end.parentNode!.insertBefore(document.createTextNode(String(result)), end);
			}
		}
	});

	return frag;
}

import { effect, collectEffects, disposeEffects, type Effect } from '../reactivity/effect';

export function if_block(
	condFn: () => unknown,
	trueFn: () => unknown,
	falseFn?: () => unknown,
): Node {
	const start = document.createComment('');
	const end = document.createComment('');
	const frag = document.createDocumentFragment();
	frag.appendChild(start);
	frag.appendChild(end);

	let currentBranch: boolean | null = null;
	let branchEffects: Effect[] = [];

	effect(() => {
		const cond = !!condFn();
		if (cond === currentBranch) return;
		currentBranch = cond;

		// Dispose inner effects from previous branch
		disposeEffects(branchEffects);
		branchEffects = [];

		while (start.nextSibling !== end) {
			start.nextSibling!.remove();
		}

		const result = collectEffects(() => {
			return cond ? trueFn() : (falseFn ? falseFn() : null);
		});
		branchEffects = result.effects;

		const node = result.value;
		if (node instanceof Node) {
			end.parentNode!.insertBefore(node, end);
		} else if (node != null && node !== false && node !== true) {
			end.parentNode!.insertBefore(document.createTextNode(String(node)), end);
		}
	});

	return frag;
}

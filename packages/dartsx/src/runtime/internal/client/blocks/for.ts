import { effect, collectEffects, disposeEffects, type Effect } from '../reactivity/effect';

interface KeyedEntry {
	key: unknown;
	nodes: Node[];
	effects: Effect[];
}

function collectNodes(result: unknown): Node[] {
	if (result instanceof DocumentFragment) {
		return Array.from(result.childNodes);
	}
	if (result instanceof Node) {
		return [result];
	}
	if (result != null && result !== false && result !== true) {
		return [document.createTextNode(String(result))];
	}
	return [];
}

function insertNodes(nodes: Node[], before: Node): void {
	const parent = before.parentNode!;
	for (const n of nodes) parent.insertBefore(n, before);
}

export function for_block(
	collFn: () => unknown[],
	bodyFn: (item: unknown, index: number) => unknown,
	keyFn?: (item: unknown) => unknown,
): Node {
	const start = document.createComment('');
	const end = document.createComment('');
	const frag = document.createDocumentFragment();
	frag.appendChild(start);
	frag.appendChild(end);

	let mapped: KeyedEntry[] = [];

	effect(() => {
		const items = collFn() || [];

		// Clear existing content
		while (start.nextSibling !== end) {
			start.nextSibling!.remove();
		}

		if (!keyFn) {
			// No key function — simple rebuild
			for (const entry of mapped) disposeEffects(entry.effects);
			mapped = [];
			for (let i = 0; i < items.length; i++) {
				const result = collectEffects(() => bodyFn(items[i], i));
				const nodes = collectNodes(result.value);
				insertNodes(nodes, end);
				mapped.push({ key: i, nodes, effects: result.effects });
			}
			return;
		}

		// Keyed reconciliation — reuse DOM nodes for items with matching keys
		const oldMap = new Map<unknown, KeyedEntry>();
		for (const entry of mapped) {
			oldMap.set(entry.key, entry);
		}

		const newMapped: KeyedEntry[] = [];
		for (let i = 0; i < items.length; i++) {
			const key = keyFn(items[i]);
			const existing = oldMap.get(key);

			if (existing) {
				// Reuse existing DOM nodes (preserves internal state, listeners, etc.)
				insertNodes(existing.nodes, end);
				newMapped.push(existing);
				oldMap.delete(key);
			} else {
				// Create new DOM nodes for this item
				const result = collectEffects(() => bodyFn(items[i], i));
				const nodes = collectNodes(result.value);
				insertNodes(nodes, end);
				newMapped.push({ key, nodes, effects: result.effects });
			}
		}
		// Dispose effects of removed entries
		for (const entry of oldMap.values()) {
			disposeEffects(entry.effects);
		}

		mapped = newMapped;
	});

	return frag;
}

/**
 * {@html expr} runtime support.
 *
 * Returns a thunk that, when called inside appendChild's reactive child effect,
 * parses the HTML string via <template>.innerHTML and returns a DocumentFragment.
 * Scripts in the HTML are NOT executed (standard innerHTML behavior).
 */
export function html_block(getValue: () => unknown): () => Node | null {
	let lastValue = '';

	return () => {
		const raw = getValue();
		const value = raw == null ? '' : String(raw);

		if (value === '') return null;

		lastValue = value;
		const template = document.createElement('template');
		template.innerHTML = value;
		return template.content;
	};
}

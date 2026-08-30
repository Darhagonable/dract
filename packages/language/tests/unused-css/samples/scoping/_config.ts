export default {
	warnings: [
		// GlobalStyleBlock: <style global> never warns; scoped <style> flags .unused
		{ selector: '.unused' },
		// GlobalSelector: :global() selectors are not flagged
		// DeepSelector: :deep() selectors are not flagged
		// NestedStyleBlocks: inner <style> scopes to .inner-box children only,
		// so h2 (not inside .inner-box) IS unused.
		// Outer <style> scopes to the whole <section>, .not-used is unused.
		{ selector: 'h2' },
		{ selector: '.not-used' },
	],
};

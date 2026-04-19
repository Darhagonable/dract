export default {
	// With multiple components per file, root-level <style> scopes
	// to the whole file. Tags like h2 and span appear in other components,
	// so they are NOT unused. Only truly absent selectors are flagged.
	warnings: [
		{ selector: '.bar' },
		// h2 exists in NoWarnings, span exists in no component → unused
		{ selector: 'span' },
		{ selector: '#missing' },
		{ selector: '.e' },
		{ selector: 'textarea' },
	],
};

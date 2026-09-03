export default {
	warnings: [
		// CommaSeparated: only .missing is unused (h1, p exist)
		{ selector: '.missing' },
		// Combinator: .missing and .nope are not in the template
		{ selector: '.parent > .missing' },
		{ selector: '.nope > .child' },
		// AttributeSelector: input tag exists, attribute values are not checked
		// (no warnings)
		// PseudoElements: .missing doesn't exist; span exists in Combinator
		// so span::before is NOT flagged (span is visible across components)
		{ selector: '.missing:hover' },
	],
};

export default {
	warnings: [
		// JsxCommentPhantom: <span> inside {/* */} should NOT count, but
		// DynamicClass has a real <span>, so span is visible file-wide.
		// Only .fake is truly unused from the comment component.
		{ selector: '.fake' },
		// DynamicClass: "on" and "off" from class={expr ? "a" : "b"} are extracted
		{ selector: '.dynamic-missing' },
	],
};

export default {
	warnings: [
		// MediaQuery: unused selector inside @media block
		{ selector: '.unused-inside-media' },
		// Keyframes: from/to stops should NOT be flagged
	],
};

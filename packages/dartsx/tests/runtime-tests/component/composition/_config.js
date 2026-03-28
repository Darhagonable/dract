export default {
	html: `<div><button>Click me</button><button>Submit</button></div>`,

	test({ assert, target }) {
		const buttons = target.querySelectorAll('button');
		assert.htmlEqual(buttons.length.toString(), '2');
		assert.htmlEqual(buttons[0].textContent, 'Click me');
		assert.htmlEqual(buttons[1].textContent, 'Submit');
	}
};

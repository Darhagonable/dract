export default {
	html: `<h1>Hello, World!</h1>`,

	test({ assert, target }) {
		assert.htmlEqual(target.querySelector('h1').textContent, 'Hello, World!');
	}
};

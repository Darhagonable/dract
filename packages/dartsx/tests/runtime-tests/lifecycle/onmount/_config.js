export default {
	html: `<p>Mounted</p>`,

	test({ assert, target }) {
		assert.htmlEqual(target.querySelector('p').textContent, 'Mounted');
	}
};

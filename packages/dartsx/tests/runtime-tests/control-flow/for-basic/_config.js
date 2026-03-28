export default {
	html: `<ul><li>Item 1</li><li>Item 2</li><li>Item 3</li></ul>`,

	test({ assert, target }) {
		const items = target.querySelectorAll('li');
		assert.htmlEqual(items.length.toString(), '3');
		assert.htmlEqual(items[0].textContent, 'Item 1');
		assert.htmlEqual(items[1].textContent, 'Item 2');
		assert.htmlEqual(items[2].textContent, 'Item 3');
	}
};

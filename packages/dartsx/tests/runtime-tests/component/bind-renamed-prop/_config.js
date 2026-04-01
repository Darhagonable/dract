export default {
	html: `<div><input><p>Hello world</p></div>`,

	async test({ assert, target, flush }) {
		const input = target.querySelector('input');

		assert.htmlEqual(input.value, 'world');

		input.value = 'DarTsx';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await flush();

		assert.htmlEqual(target.querySelector('p').textContent, 'Hello DarTsx');
	},
};

export default {
	html: `<div><input><p>Hello world</p></div>`,

	async test({ assert, target, flush }) {
		const input = target.querySelector('input');

		// Verify initial value synced to input
		assert.htmlEqual(input.value, 'world');

		// Simulate user typing — update input and fire event
		input.value = 'DarTsx';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await flush();

		// The <p> should reflect the new proxy property value
		assert.htmlEqual(target.querySelector('p').textContent, 'Hello DarTsx');

		// Verify the input still shows the typed value
		assert.htmlEqual(input.value, 'DarTsx');
	}
};

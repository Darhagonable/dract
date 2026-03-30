export default {
	html: `<div><input><p>Hello</p></div>`,

	async test({ assert, target, flush }) {
		const input = target.querySelector('input');

		// Verify initial value synced to input
		assert.htmlEqual(input.value, 'Hello');

		// Simulate user typing — setter transforms to uppercase
		input.value = 'world';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await flush();

		// The setter uppercases, so state should be "WORLD"
		assert.htmlEqual(target.querySelector('p').textContent, 'WORLD');

		// The input should also reflect the transformed value
		assert.htmlEqual(input.value, 'WORLD');
	}
};

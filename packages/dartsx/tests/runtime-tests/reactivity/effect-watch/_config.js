export default {
	html: `<button>increment</button><p>0 -> 0</p>`,

	async test({ assert, target, flush }) {
		const btn = target.querySelector('button');

		btn.click();
		await flush();
		assert.htmlEqual(target.querySelector('p').textContent, '0 -> 1');

		btn.click();
		await flush();
		assert.htmlEqual(target.querySelector('p').textContent, '1 -> 2');
	}
};

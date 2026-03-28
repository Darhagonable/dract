export default {
	html: `<button>clicks: 0</button>`,

	async test({ assert, target, flush }) {
		const btn = target.querySelector('button');

		btn.click();
		await flush();
		assert.htmlEqual(target.querySelector('button').textContent, 'clicks: 1');

		btn.click();
		await flush();
		assert.htmlEqual(target.querySelector('button').textContent, 'clicks: 2');
	}
};

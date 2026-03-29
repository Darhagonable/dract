export default {
	html: `<div><button>cycle</button><span>A</span></div>`,

	async test({ assert, target, flush }) {
		const btn = target.querySelector('button');

		btn.click();
		await flush();
		assert.htmlEqual(target.querySelector('span').textContent, 'B');

		btn.click();
		await flush();
		assert.htmlEqual(target.querySelector('span').textContent, 'C');

		btn.click();
		await flush();
		assert.htmlEqual(target.querySelector('span').textContent, 'A');
	}
};

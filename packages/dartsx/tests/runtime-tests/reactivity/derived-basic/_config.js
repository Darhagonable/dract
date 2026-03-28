export default {
	html: `<button>2</button><p>4</p>`,

	async test({ assert, target, flush }) {
		const btn = target.querySelector('button');

		btn.click();
		await flush();
		assert.htmlEqual(target.querySelector('button').textContent, '3');
		assert.htmlEqual(target.querySelector('p').textContent, '6');
	}
};

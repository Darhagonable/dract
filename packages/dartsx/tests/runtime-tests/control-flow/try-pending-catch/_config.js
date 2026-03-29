export default {
	html: `<div><span>loading</span></div>`,

	async test({ assert, target, flush }) {
		// Initially shows pending content
		assert.htmlEqual(target.querySelector('span').textContent, 'loading');

		// Wait for the async content to resolve
		await new Promise((r) => setTimeout(r, 50));
		await flush();

		assert.htmlEqual(target.querySelector('span').textContent, 'done');
	}
};

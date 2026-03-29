export default {
	html: `<div><button>toggle</button><span>Mode A</span></div>`,

	async test({ assert, target, flush }) {
		const btn = target.querySelector('button');

		btn.click();
		await flush();
		assert.htmlEqual(target.querySelector('span').textContent, 'Mode B');

		btn.click();
		await flush();
		assert.htmlEqual(target.querySelector('span').textContent, 'Mode A');
	}
};

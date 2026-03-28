export default {
	html: `<div><button>toggle</button><span>truthy</span></div>`,

	async test({ assert, target, flush }) {
		const btn = target.querySelector('button');

		btn.click();
		await flush();
		assert.htmlEqual(target.querySelector('span'), null);

		btn.click();
		await flush();
		assert.htmlEqual(target.querySelector('span').textContent, 'truthy');
	}
};

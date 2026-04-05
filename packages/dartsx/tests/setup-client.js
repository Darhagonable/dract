import { beforeEach, afterEach } from 'vitest';
import { mount } from 'dartsx';

let _unmount;

globalThis.mountComponent = function mountComponent(component) {
	const result = mount(component, globalThis.container);
	_unmount = result.unmount;
	return result;
};

beforeEach(() => {
	globalThis.container = document.createElement('div');
	document.body.appendChild(globalThis.container);
	_unmount = undefined;
});

afterEach(() => {
	if (_unmount) _unmount();
	if (globalThis.container?.parentNode) {
		document.body.removeChild(globalThis.container);
	}
	globalThis.container = undefined;
});

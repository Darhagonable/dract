import { describe, it, expect } from 'vitest';
import { mount } from 'dartsx';
import $ from 'dartsx/internal/client';

describe('jsx > svg namespace (compile-time)', () => {
	it('$.svg() creates elements with SVG namespace', () => {
		const circle = $.svg('circle', { cx: '50' });
		expect((circle as Element).namespaceURI).toBe('http://www.w3.org/2000/svg');
	});

	it('$.jsx() creates elements with HTML namespace', () => {
		const div = $.jsx('div');
		expect((div as Element).namespaceURI).toBe('http://www.w3.org/1999/xhtml');
	});

	it('creates svg elements with SVG namespace', () => {
		component SvgBasic() {
			render (
				<svg viewBox="0 0 100 100">
					<circle cx="50" cy="50" r="40" fill="red" />
					<rect x="10" y="10" width="30" height="30" />
				</svg>
			);
		}

		mount(SvgBasic, document.body);
		const svg = document.querySelector('svg')!;
		expect(svg).not.toBeNull();
		expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');

		const circle = svg.querySelector('circle')!;
		expect(circle.namespaceURI).toBe('http://www.w3.org/2000/svg');

		const rect = svg.querySelector('rect')!;
		expect(rect.namespaceURI).toBe('http://www.w3.org/2000/svg');
	});

	it('inherits SVG namespace through nested groups', () => {
		component SvgNested() {
			render (
				<svg>
					<g>
						<g>
							<path d="M0 0 L10 10" />
						</g>
					</g>
				</svg>
			);
		}

		mount(SvgNested, document.body);
		const path = document.querySelector('path')!;
		expect(path.namespaceURI).toBe('http://www.w3.org/2000/svg');
	});

	it('exits SVG namespace inside foreignObject', () => {
		component SvgForeignObject() {
			render (
				<svg viewBox="0 0 200 200">
					<foreignObject x="0" y="0" width="200" height="200">
						<div class="html-content">Hello</div>
					</foreignObject>
				</svg>
			);
		}

		mount(SvgForeignObject, document.body);
		const foreignObj = document.querySelector('foreignObject')!;
		expect(foreignObj.namespaceURI).toBe('http://www.w3.org/2000/svg');

		const div = foreignObj.querySelector('div')!;
		expect(div.namespaceURI).toBe('http://www.w3.org/1999/xhtml');
	});

	it('does not use SVG namespace for elements outside svg', () => {
		component MixedContent() {
			render (
				<div>
					<svg><circle cx="10" cy="10" r="5" /></svg>
					<span>text</span>
				</div>
			);
		}

		mount(MixedContent, document.body);
		const span = document.querySelector('span')!;
		expect(span.namespaceURI).toBe('http://www.w3.org/1999/xhtml');

		const circle = document.querySelector('circle')!;
		expect(circle.namespaceURI).toBe('http://www.w3.org/2000/svg');
	});
});

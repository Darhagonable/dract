import { describe, it, expect } from 'vitest';
import { tick, mount } from 'dartsx';

describe('component > props', () => {
	it('passes props to child components', () => {
		component GreetingWithProp(name: string) {
			render (
				<h1>Hello, {name}!</h1>
			);
		}

		component PropsApp() {
			render (
				<GreetingWithProp name="Alice" />
			);
		}

		mount(PropsApp, document.body);
		expect(document.querySelector('h1')!.textContent).toBe('Hello, Alice!');
	});

	it('supports renamed props with defaults', () => {
		component RenamedPropsGreeting(
			'first-name' as firstName: string,
			'user-age' as age: number = 18,
		) {
			render (
				<section>
					<h1>{firstName}</h1>
					<p>Age: {age}</p>
				</section>
			)
		}

		component RenamedPropsApp() {
			render (
				<RenamedPropsGreeting first-name="Alice" />
				<RenamedPropsGreeting first-name="Bob" user-age={42} />
			)
		}

		mount(RenamedPropsApp, document.body);
		const sections = document.querySelectorAll('section');
		expect(sections[0].querySelector('h1')!.textContent).toBe('Alice');
		expect(sections[0].querySelector('p')!.textContent).toBe('Age: 18');
		expect(sections[1].querySelector('h1')!.textContent).toBe('Bob');
		expect(sections[1].querySelector('p')!.textContent).toBe('Age: 42');
	});
});

describe('component > default props', () => {
	it('uses default values when some props not provided', () => {
		component Button(label: string = "Click me", variant: string = "primary") {
			render (
				<button class={variant}>{label}</button>
			);
		}

		component App() {
			render (
				<Button label="Submit" />
				<Button label="Cancel" variant="secondary" />
			);
		}

		mount(App, document.body);
		const buttons = document.querySelectorAll('button');
		expect(buttons[0].textContent).toBe('Submit');
		expect(buttons[0].className).toBe('primary');
		expect(buttons[1].textContent).toBe('Cancel');
		expect(buttons[1].className).toBe('secondary');
	});
});

describe('component > rest props', () => {
	it('passes rest props through to element', () => {
		component Input(type: string = "text", ...rest) {
			render (
				<input type={type} {...rest} />
			);
		}

		component App() {
			render (
				<Input placeholder="Enter name" class="form-input" />
			);
		}

		mount(App, document.body);
		const input = document.querySelector('input')!;
		expect(input.type).toBe('text');
		expect(input.placeholder).toBe('Enter name');
		expect(input.className).toBe('form-input');
	});
});

describe('component > spread props', () => {
	it('spreads an object as props', () => {
		component Profile(name: string, age: number) {
			render (
				<span class="name">{name}</span>
				<span class="age">{age}</span>
			);
		}

		component App() {
			state user = { name: "Alice", age: 30 };

			render (
				<Profile {...user} />
			);
		}

		mount(App, document.body);
		expect(document.querySelector('.name')!.textContent).toBe('Alice');
		expect(document.querySelector('.age')!.textContent).toBe('30');
	});
});

describe('component > object and array props', () => {
	it('passes an object as a prop', () => {
		component Card(style: { color: string; bold: boolean }) {
			render (
				<div class="card" data-color={style.color}>{style.bold ? 'BOLD' : 'normal'}</div>
			);
		}

		component App() {
			render <Card style={{ color: 'red', bold: true }} />;
		}

		mount(App, document.body);
		const card = document.querySelector('.card')!;
		expect(card.getAttribute('data-color')).toBe('red');
		expect(card.textContent).toBe('BOLD');
	});

	it('passes an array literal as a prop', () => {
		component List(items) {
			render (
				<ul>
					{for (const item of items) (
						<li>{item}</li>
					)}
				</ul>
			);
		}

		component App() {
			render <List items={['apple', 'banana', 'cherry']} />;
		}

		mount(App, document.body);
		const lis = document.querySelectorAll('li');
		expect(lis.length).toBe(3);
		expect(lis[0].textContent).toBe('apple');
		expect(lis[1].textContent).toBe('banana');
		expect(lis[2].textContent).toBe('cherry');
	});

	it('reactively updates an object prop', async () => {
		component Display(data: { label: string }) {
			render <span>{data.label}</span>;
		}

		component App() {
			state data = { label: 'hello' };
			render (
				<Display data={data} />
				<button onclick={() => data = { label: 'world' }}>change</button>
			);
		}

		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('hello');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('world');
	});

	it('reactively updates an array prop', async () => {
		component Tags(items) {
			render (
				<ul>
					{for (const t of items) (
						<li>{t}</li>
					)}
				</ul>
			);
		}

		component App() {
			state tags = ['a', 'b'];
			render (
				<Tags items={tags} />
				<button onclick={() => tags = [...tags, 'c']}>add</button>
			);
		}

		mount(App, document.body);
		expect(document.querySelectorAll('li').length).toBe(2);

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelectorAll('li').length).toBe(3);
		expect(document.querySelectorAll('li')[2].textContent).toBe('c');
	});
});

describe('component > callback props', () => {
	it('child calls a parent callback', async () => {
		component Child(onAction) {
			render <button onclick={() => onAction('clicked')}>do it</button>;
		}

		component App() {
			state log = '';
			render (
				<Child onAction={(msg) => log = msg} />
				<span>{log}</span>
			);
		}

		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('clicked');
	});

	it('child calls a parent callback that updates state', async () => {
		component Counter(count, onIncrement) {
			render (
				<span>{count}</span>
				<button onclick={onIncrement}>inc</button>
			);
		}

		component App() {
			state count = 0;

			function handleIncrement() {
				count++;
			}

			render <Counter count={count} onIncrement={handleIncrement} />;
		}

		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('0');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('1');

		document.querySelector('button')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('2');
	});

	it('child calls a parent callback with a return value', () => {
		component Validator(validate) {
			render <span>{validate('hello') ? 'valid' : 'invalid'}</span>;
		}

		component App() {
			render <Validator validate={(v) => v.length > 3} />;
		}

		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('valid');
	});

	it('parent passes multiple callbacks', async () => {
		component Actions(onSave, onCancel) {
			render (
				<button class="save" onclick={onSave}>save</button>
				<button class="cancel" onclick={onCancel}>cancel</button>
			);
		}

		component App() {
			state log = '';
			render (
				<Actions onSave={() => log = 'saved'} onCancel={() => log = 'cancelled'} />
				<span>{log}</span>
			);
		}

		mount(App, document.body);
		document.querySelector<HTMLElement>('.save')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('saved');

		document.querySelector<HTMLElement>('.cancel')!.click();
		await tick();
		expect(document.querySelector('span')!.textContent).toBe('cancelled');
	});

	it('passes a callback prop that returns JSX', async () => {
		component Fallback() {
			render <span>fallback content</span>
		}

		component Wrapper(fallback?: () => any) {
			render (
				<div>
					{fallback ? fallback() : 'no fallback'}
				</div>
			);
		}

		component App() {
			render <Wrapper fallback={() => <Fallback />} />
		}

		mount(App, document.body);
		expect(document.querySelector('span')!.textContent).toBe('fallback content');
	});
});

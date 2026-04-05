import { describe, it, expect } from 'vitest';
import { tick } from 'dartsx';

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

		mountComponent(PropsApp);
		expect(container.querySelector('h1').textContent).toBe('Hello, Alice!');
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

		mountComponent(RenamedPropsApp);
		const sections = container.querySelectorAll('section');
		expect(sections[0].querySelector('h1').textContent).toBe('Alice');
		expect(sections[0].querySelector('p').textContent).toBe('Age: 18');
		expect(sections[1].querySelector('h1').textContent).toBe('Bob');
		expect(sections[1].querySelector('p').textContent).toBe('Age: 42');
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

		mountComponent(App);
		const buttons = container.querySelectorAll('button');
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

		mountComponent(App);
		const input = container.querySelector('input');
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

		mountComponent(App);
		expect(container.querySelector('.name').textContent).toBe('Alice');
		expect(container.querySelector('.age').textContent).toBe('30');
	});
});

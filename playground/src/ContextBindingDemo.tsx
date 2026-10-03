import { createContext, provide } from "dartsx";

// A reactive context whose value is a deep-reactive object: binding an input
// to `profile.name` works because the binding's setter writes through the
// state proxy — no prop drilling, no callback props.
const ProfileContext = createContext((initialName: string) => {
	state name = initialName;
	return name;
});

component ProfileProvider() {
	provide(ProfileContext, "Alice");
	render (
		<div>
			<NameForm />
			<NameDisplay />
		</div>
	);
}

component NameForm() {
	derived name = ProfileContext();
	render (
		<label>
			Name:
			<input bind:value={name} />
			<button onclick={() => (name = "Alice")}>Reset</button>
		</label>
	);
}

component NameDisplay() {
	derived name = ProfileContext();
	render <p>Hello, {name}! ({name.length} characters)</p>;
}

export component ContextBindingDemo() {
	render (
		<div>
			<h2>Reactive Context with Two-Way Binding</h2>
			<p>The input writes through the context; every consumer updates live.</p>
			<ProfileProvider />
		</div>
	);
}

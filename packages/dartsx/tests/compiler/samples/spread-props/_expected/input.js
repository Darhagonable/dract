import $ from "dartsx/internal/client";

function Input($$props) {
	const label = $.prop($$props, "label");
	let rest = $$props;

	return $.jsx("label", {
		children: [() => $.get(label), " ", $.jsx("input", $.mergeProps(rest))]
	});
}

function App() {
	let name = $.state("alice");

	return $.jsx(Input, {
		label: "Name:",
		get value() {
			return $.get(name);
		},
		class: "field"
	});
}
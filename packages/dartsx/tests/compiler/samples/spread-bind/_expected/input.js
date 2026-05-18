import $ from "dartsx/internal/client";

function Input($$props) {
	let rest = $$props;

	return $.jsx("input", $.mergeProps(rest));
}

function App() {
	let name = $.state("alice");

	return $.jsx(Input, {
		get value() {
			return $.get(name);
		},

		set value(v) {
			$.set(name, v);
		}
	});
}
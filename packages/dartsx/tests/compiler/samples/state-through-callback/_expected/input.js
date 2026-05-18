import $ from "dartsx/internal/client";
import { effect } from "dartsx";

function withLogger(value, label) {
	effect(value, (val) => console.log(`[${label}]`, val));
}

function withValidator(value, validate) {
	effect(value, (val) => {
		if (!validate(val)) console.warn("invalid:", val);
	});
}

function Form() {
	let name = $.state("");
	let age = $.state(0);

	withLogger(name, "name");
	withLogger(age, "age");
	withValidator(name, (v) => v.length > 0);

	return $.jsx("div", {
		children: [
			$.jsx("input", {
				get value() {
					return $.get(name);
				}
			}),

			$.jsx("input", {
				get value() {
					return $.get(age);
				},
				type: "number"
			})
		]
	});
}
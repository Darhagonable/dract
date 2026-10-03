import $ from "dartsx/internal/client";
import { createContext, provide } from "dartsx";

export const NameContext = createContext((initialName) => {
	let name = $.state(initialName);

	return name;
});

function NameForm() {
	let name = NameContext();

	return $.jsx("div", {
		children: [
			$.jsx("input", {
				get value() {
					return $.get(name);
				},

				set value(v) {
					$.set(name, v);
				}
			}),
			$.jsx("button", { onclick: () => $.set(name, "Alice"), children: ["Reset"] })
		]
	});
}

export function Demo() {
	provide(NameContext, "Alice");

	return $.jsx(NameForm);
}
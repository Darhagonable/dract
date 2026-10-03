import $ from "dartsx/internal/client";
import { createContext, provide } from "dartsx";

export const MyContext = createContext((initial) => {
	let name = $.state(initial);
	const length = $.derived(() => $.get(name).length);

	const ctx = {
		get name() {
			return $.get(name);
		},

		set name(v) {
			$.set(name, v);
		},

		get length() {
			return $.get(length);
		},
		set length(v) {}
	};

	return ctx;
});

function Writer() {
	let __destructured_0 = MyContext(),
		name = $.prop.bind(__destructured_0, "name"),
		length = $.derived(() => __destructured_0.length);

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

			$.jsx("button", {
				onclick: () => $.set(name, "something new"),
				children: ["write"]
			}),
			$.jsx("span", { children: [() => $.get(length)] })
		]
	});
}

function Reader() {
	let ctx = MyContext();

	return $.jsx("div", {
		children: [
			$.jsx("p", { children: [() => ctx.name] }),
			$.jsx("button", { onclick: () => ctx.name = "via ctx", children: ["ctx write"] })
		]
	});
}

export function Demo() {
	provide(MyContext, "default");

	return $.jsx("div", { children: [$.jsx(Writer), $.jsx(Reader)] });
}
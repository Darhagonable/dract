import $ from "dartsx/internal/client";
import { effect } from "dartsx";

function Counter() {
	let count = $.state(0);

	effect(count, (val) => {
		console.log(val);
	});

	return $.jsx("p", { children: [() => $.get(count)] });
}

function Display($$props) {
	const count = $.prop($$props, "count");

	effect(count, (val) => {
		console.log(val);
	});

	return $.jsx("p", { children: [() => $.get(count)] });
}
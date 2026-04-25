import $ from "dartsx/internal/client";
import { effect } from "dartsx";
let count = $.state(0);
function Test() {
	effect(count, (val) => {
		console.log(val);
	});
	return $.jsx("p", { children: [() => $.get(count)] });
}

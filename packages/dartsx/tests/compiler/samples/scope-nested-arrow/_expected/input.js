import $ from "dartsx/internal/client";
function Timer() {
	let count = $.state(0);
	let name = $.state("timer");
	const start = () => {
		const count = getStartValue();
		const tick = (count) => {
			const name = `tick-${count}`;
			console.log(name, count);
		};
		tick(count);
	};
	return $.jsx("div", { children: [
		$.jsx("h2", { children: [() => $.get(name)] }),
		$.jsx("p", { children: [() => $.get(count)] }),
		$.jsx("button", {
			onclick: start,
			children: ["start"]
		}),
		$.jsx("button", {
			onclick: () => $.set(count, $.get(count) + 1),
			children: ["inc"]
		})
	] });
}

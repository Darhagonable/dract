import $ from "dartsx/internal/client";
import { count, user, resetCount } from "./store";
import { watchValue, formatUser } from "./utils";

export default function App() {
	let localCount = $.state(0);

	watchValue(count, (val) => console.log("store count:", val));

	function handleClick() {
		const count = $.get(localCount) + 1;

		console.log("computed count:", count);
	}

	const processUser = (user) => {
		return user.name.toUpperCase();
	};

	return $.jsx("div", {
		children: [
			$.jsx("p", { children: ["Store: ", () => $.get(count)] }),
			$.jsx("p", { children: ["Local: ", () => $.get(localCount)] }),
			$.jsx("p", { children: ["User: ", () => formatUser(user)] }),
			$.jsx("p", { children: ["Processed: ", () => processUser($.get(user))] }),
			$.jsx("button", {
				onclick: () => $.set(localCount, $.get(localCount) + 1),
				children: ["local++"]
			}),

			$.jsx("button", {
				onclick: () => $.set(count, $.get(count) + 1),
				children: ["store++"]
			}),
			$.jsx("button", { onclick: handleClick, children: ["handle"] }),
			$.jsx("button", { onclick: resetCount, children: ["reset"] })
		]
	});
}
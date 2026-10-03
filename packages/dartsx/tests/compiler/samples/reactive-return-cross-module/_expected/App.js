import $ from "dartsx/internal/client";
import { ProfileContext, useProfile } from "./factory.ts";

let profile = useProfile();

function App() {
	let __destructured_0 = ProfileContext(),
		user = $.prop.bind(__destructured_0, "user");

	return $.jsx("div", {
		children: [
			$.jsx("input", {
				get value() {
					return $.get(profile).name;
				},

				set value(v) {
					$.get(profile).name = v;
				}
			}),
			$.jsx("p", { children: [() => $.get(user)] })
		]
	});
}
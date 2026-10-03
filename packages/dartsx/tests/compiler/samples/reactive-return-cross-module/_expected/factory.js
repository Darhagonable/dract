import $ from "dartsx/internal/client";
import { createContext } from "dartsx";

export function useProfile() {
	let profile = $.state({ name: "Alice" });

	return profile;
}

export const ProfileContext = createContext(() => {
	let user = $.state("bob");

	return {
		get user() {
			return $.get(user);
		},

		set user(v) {
			$.set(user, v);
		}
	};
});
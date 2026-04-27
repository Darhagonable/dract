import $ from "dartsx/internal/client";
import { effect } from "dartsx";

export function watchValue(value, callback) {
	effect(value, callback);
}

export function formatUser(user) {
	return `${$.get(user).name} (${$.get(user).role})`;
}
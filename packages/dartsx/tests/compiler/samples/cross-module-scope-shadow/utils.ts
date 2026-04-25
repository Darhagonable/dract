import { effect } from 'dartsx'

export function watchValue(value, callback) {
	effect(value, callback)
}

export function formatUser(user) {
	return `${user.name} (${user.role})`
}

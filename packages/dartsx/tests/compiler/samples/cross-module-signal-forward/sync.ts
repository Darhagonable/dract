import { effect } from 'dartsx'

export function syncToStorage(key, value) {
	effect(value, (val) => {
		console.log(key, val)
	})
}

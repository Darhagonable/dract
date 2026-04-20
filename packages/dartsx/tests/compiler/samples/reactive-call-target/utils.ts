import { effect } from 'dartsx'

export function watchCount(count) {
	effect(count, (val) => {
		console.log('count changed:', val)
	})
}

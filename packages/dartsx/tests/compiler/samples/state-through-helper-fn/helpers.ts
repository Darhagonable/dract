import { effect } from 'dartsx'

export function createLogger(label) {
	return function log(value) {
		effect(value, (val) => console.log(`[${label}]`, val))
	}
}

export function combineSignals(a, b, fn) {
  derived result = fn(a, b)
	return result
}

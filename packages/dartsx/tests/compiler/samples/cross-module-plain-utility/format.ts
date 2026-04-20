import { numberFormat } from './numberFormat'

export function formatCount(count) {
	return `Count: ${numberFormat(count)}`;
}

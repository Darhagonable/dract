import { effect } from 'dartsx';

/**
 * Sync a reactive value to localStorage whenever it changes.
 * The caller passes a state variable; this function forwards it to effect().
 */
export function syncToStorage(key: string, value: any) {
	effect(value, (val, prev) => {
		if (val === prev) return; // avoid writing to storage if the value didn't actually change
		console.log(`[syncToStorage] saving "${key}" =`, val);
		localStorage.setItem(key, JSON.stringify(val));
	});
}

/**
 * Read the stored value back from localStorage.
 */
export function readFromStorage(key: string): string | null {
	return localStorage.getItem(key);
}

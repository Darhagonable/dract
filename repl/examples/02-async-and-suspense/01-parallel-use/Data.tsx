// Fake API module — each call takes 700ms. Because the two fetches are
// independent, octane starts them in parallel for the same boundary.
function delay<T>(ms: number, value: T): Promise<T> {
	return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export function fetchCity(attempt: number) {
	return delay(700, 'Reykjavík (' + attempt + ')');
}

export function fetchForecast(attempt: number) {
	return delay(700, 'aurora with a chance of drizzle (' + attempt + ')');
}

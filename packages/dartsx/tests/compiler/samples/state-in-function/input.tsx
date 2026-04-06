function createCounter() {
	state count = 0
	const increment = () => count++
	return { count, increment }
}

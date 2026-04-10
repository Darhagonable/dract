function createState() {
  state count = 0
  const increment = () => count++
  return Object.defineProperties({}, {
    count: { get() { return count } },
    increment: { value: increment }
  })
}

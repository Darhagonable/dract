function createState() {
  let count = $.state(0)
  const increment = () => $.set(count, $.get(count) + 1)
  return Object.defineProperties({}, {
    count: { get() { return $.get(count) } },
    increment: { value: increment }
  })
}

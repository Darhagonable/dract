component App() {
  function greet() { return 'hello' }
  state fn = Object.assign(greet, { count: 0 })

  render (
    <button onclick={() => fn.count++}>inc</button>
    <span>{fn.count}</span>
    <span>{fn()}</span>
  )
}

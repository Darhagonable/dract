component App() {
  state count = 0

  function reset() {
    const count = getInitialCount()
    console.log(count)
    return count
  }

  render (
    <div>
      <p>{count}</p>
      <button onclick={() => count++}>inc</button>
      <button onclick={reset}>reset</button>
    </div>
  )
}

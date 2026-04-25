component Timer() {
  state count = 0
  state name = 'timer'

  const start = () => {
    const count = getStartValue()
    const tick = (count: number) => {
      const name = `tick-${count}`
      console.log(name, count)
    }
    tick(count)
  }

  render (
    <div>
      <h2>{name}</h2>
      <p>{count}</p>
      <button onclick={start}>start</button>
      <button onclick={() => count++}>inc</button>
    </div>
  )
}

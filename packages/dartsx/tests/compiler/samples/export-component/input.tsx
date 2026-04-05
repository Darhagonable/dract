export component Counter() {
  state count = 0
  render (
    <button onclick={count++}>{count}</button>
  )
}

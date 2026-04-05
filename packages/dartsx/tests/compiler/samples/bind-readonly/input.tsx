component Layout() {
  state width = 0
  render (
    <div bind:clientWidth={null, (v) => width = v}>content</div>
  )
}

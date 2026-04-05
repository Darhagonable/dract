function runTest() {
  component Greeting(name = "world") {
    state count = 0
    render (
      <div>Hello {name} {count}</div>
    )
  }
  return Greeting;
}

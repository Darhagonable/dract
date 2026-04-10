component App() {
  state data = { render: () => "hello" }
  const result = data.render()
  render (
    <div>{result}</div>
  )
}

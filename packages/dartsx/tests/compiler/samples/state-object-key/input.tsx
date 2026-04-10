component App() {
  state count = 0
  const obj = { count: 42, other: count }
  render (
    <div>{obj.count} {count}</div>
  )
}

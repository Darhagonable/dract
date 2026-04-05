component App() {
  state items = [1, 2, 3]
  render (
    {for (const n of items) {
      <p>{n}</p>
    }}
  )
}

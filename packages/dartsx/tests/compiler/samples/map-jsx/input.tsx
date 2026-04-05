component App() {
  state items = ["a", "b", "c"]
  render (
    <ul>
      {items.map(item => <li>{item}</li>)}
    </ul>
  )
}

component App() {
  state items = ["a", "b"]
  render (
    <ul>
      {items.map((item, i) => <li>{i}: {item}</li>)}
    </ul>
  )
}

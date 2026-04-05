component App() {
  state items = ["a", "b", "c"]
  render (
    <ul>
      {for (const item of items)
        <li>{item}</li>
      }
    </ul>
  )
}

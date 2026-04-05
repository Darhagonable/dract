component App() {
  state obj = { a: 1, b: 2 }
  render (
    <ul>
      {for (const key in obj) {
        <li>{key}</li>
      }}
    </ul>
  )
}

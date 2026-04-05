component App() {
  state obj = { a: 1, b: 2 }
  render (
    <ul>
      {for (const key in obj) {
        const value = obj[key];
        render <li>{key}:{value}</li>
      }}
    </ul>
  )
}

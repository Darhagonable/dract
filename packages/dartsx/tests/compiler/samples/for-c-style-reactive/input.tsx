component App() {
  state count = 5
  render (
    <ul>
      {for (let i = 0; i < count; i++) {
        <li>{i}</li>
      }}
    </ul>
  )
}

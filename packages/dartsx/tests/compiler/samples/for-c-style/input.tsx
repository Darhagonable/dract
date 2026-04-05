component App() {
  render (
    <ul>
      {for (let i = 0; i < 5; i++) {
        <li>{i}</li>
      }}
    </ul>
  )
}

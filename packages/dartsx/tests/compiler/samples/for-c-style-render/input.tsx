component App() {
  state count = 3
  render (
    <ul>
      {for (let i = 0; i < count; i++) {
        const label = `item-${i}`;
        render <li>{label}</li>
      }}
    </ul>
  )
}

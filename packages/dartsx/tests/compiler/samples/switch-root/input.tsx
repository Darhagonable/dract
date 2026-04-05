component App() {
  state mode = 'a'
  render (
    {switch (mode) {
      case 'a':
        <p>A</p>
        break;
      case 'b':
        <p>B</p>
        break;
    }}
  )
}

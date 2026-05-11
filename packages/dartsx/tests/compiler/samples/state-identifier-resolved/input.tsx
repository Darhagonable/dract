component App() {
  const obj = { x: 1, y: 2 };
  state data = obj;

  render (
    <div>{data.x}</div>
  )
}

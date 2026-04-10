component App() {
  state count: number = 0
  derived doubled: number = count * 2
  render (
    <div>{doubled}</div>
  )
}

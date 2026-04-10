component App() {
  state name: string = "hello"
  state count: number | null = 0
  render (
    <div>{name} {count}</div>
  )
}

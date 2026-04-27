component Counter() {
  state count = 0
  derived doubled = count * 2

  render (
    <div>
      <button onclick={count++}>+1</button>
      <span>{count}</span>
      <span>doubled: {doubled}</span>
    </div>
  )
}

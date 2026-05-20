export default component Counter() {
  state count = 0
  derived doubled = count * 2

  render (
    <div>
      <button onclick={count++}>
        clicks: {count}
      </button>
      <p>doubled: {doubled}</p>
    </div>
  )
}

component HelloWorld() {
  state name = "world"
  state count = 0
  derived doubled = count * 2

  render (
    <h1>Hello {name}</h1>
    <input bind:value={name} />
    <button onclick={count += 1}>
      clicks: {count}
    </button>
    <p>doubled: {doubled}</p>
  )
}

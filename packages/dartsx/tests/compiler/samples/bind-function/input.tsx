component Form() {
  state value = "hello"
  render (
    <input bind:value={
      () => value,
      (v) => value = v.toLowerCase()
    } />
  )
}

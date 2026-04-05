component Form() {
  state form = { name: "", email: "" }
  render (
    <input bind:value={form.name} />
  )
}

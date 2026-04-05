component Parent() {
  state form = { name: "" }
  render (
    <Child bind:name={form.name} />
  )
}

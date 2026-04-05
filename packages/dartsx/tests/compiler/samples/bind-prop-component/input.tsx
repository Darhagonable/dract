component Parent() {
  state name = "hello"
  render (
    <Child bind:name={name} />
  )
}

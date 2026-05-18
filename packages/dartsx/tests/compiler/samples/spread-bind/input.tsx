component Input(...rest) {
  render <input {...rest} />
}
component App() {
  state name = "alice"
  render <Input bind:value={name} />
}

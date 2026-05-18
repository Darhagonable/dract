component Input(label: string, ...rest) {
  render (
    <label>
      {label}
      <input {...rest} />
    </label>
  )
}

component App() {
  state name = "alice"

  render (
    <Input label="Name:" value={name} class="field" />
  )
}

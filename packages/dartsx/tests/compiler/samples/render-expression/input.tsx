component Wrapper() {
  state value = "hello"

  function getValue() {
    return value
  }

  render getValue()
}

component WithNull() {
  render null
}

component Conditional(show: boolean) {
  if (show) {
    render "visible"
  }
  render "hidden"
}

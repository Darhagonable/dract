state x = 1
derived info = {
  value: x,
  label: 'count'
}

component Display() {
  render <span>{info.value}</span>
}

state moduleLevel: number

function setup() {
  state fnLevel: boolean
  return fnLevel
}

component App() {
  state count = 0
  state label: string
  state items: string[]

  render (
    <div>{count} {label} {items} {moduleLevel}</div>
  )
}

function teardown() {
  state fnLevel: boolean
  return fnLevel
}

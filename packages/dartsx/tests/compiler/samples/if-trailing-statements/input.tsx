// A control-flow container with trailing statements: the statements after
// the leading if must never be silently dropped — they run once when the
// container evaluates, and the reactive node is returned afterwards.
component App() {
  state show = true
  state effects: string[] = []

  render (
    <div>
      {if (show) (
        <p>Hello</p>
      )
      effects.push('ran')}
    </div>
  )
}

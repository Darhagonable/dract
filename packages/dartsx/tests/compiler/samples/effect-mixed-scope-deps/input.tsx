import { effect } from 'dartsx'

state theme = 'dark'

component Panel(visible: boolean) {
  state size = 0

  effect([theme, visible, size], ([t], [v], [s]) => { console.log(t, v, s) })

  render (
    <p>{theme}</p>
  )
}

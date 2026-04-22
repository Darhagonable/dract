import { effect } from 'dartsx'

component Counter() {
  state count = 0

  effect(count, (val) => { console.log(val) })

  render (
    <p>{count}</p>
  )
}

component Display(count: string) {
  effect(count, (val) => { console.log(val) })

  render (
    <p>{count}</p>
  )
}

import { effect } from 'dartsx'

state count = 0

component Test() {
  effect(count, (val) => { console.log(val) })

  render (
    <p>{count}</p>
  )
}

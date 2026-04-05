import { effect } from 'dartsx'

component App() {
  state count = 0

  effect(count, (val) => {
    console.log(val);
  })

  render (
    <p>{count}</p>
  )
}

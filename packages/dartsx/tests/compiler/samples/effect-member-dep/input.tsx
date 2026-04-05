import { effect } from 'dartsx'

component App() {
  state obj = { count: 0 }

  effect(obj.count, (count, prevCount) => {
    console.log(count);
  })

  render (
    <p>{obj.count}</p>
  )
}

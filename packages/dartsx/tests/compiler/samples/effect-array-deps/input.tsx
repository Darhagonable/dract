import { effect } from 'dartsx'

component App() {
  state obj = { a: 1, b: 2 }

  effect([obj.a, obj.b], ([a], [b]) => {
    console.log(a + b);
  })

  render (
    <p>{obj.a}</p>
  )
}

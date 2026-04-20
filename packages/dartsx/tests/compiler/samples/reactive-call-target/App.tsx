import { watchCount } from './utils'

component App() {
  state obj = { count: 0 }

  watchCount(obj.count)

  render (
    <p>{obj.count}</p>
  )
}

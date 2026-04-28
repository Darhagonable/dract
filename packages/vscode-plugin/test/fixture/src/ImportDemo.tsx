import { count, doubled } from './store'

component ImportDemo() {
  render (
    <div>
      <p>{count}</p>
      <p>{doubled}</p>
    </div>
  )
}

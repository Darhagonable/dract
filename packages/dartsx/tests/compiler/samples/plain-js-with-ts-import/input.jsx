import { count, increment } from './store'

component App() {
  render (
    <div>
      <span>{count}</span>
      <button onclick={increment}>+1</button>
    </div>
  )
}

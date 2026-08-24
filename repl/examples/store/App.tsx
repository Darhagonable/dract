import { count, user, displayName } from "./store"

export default component App() {

  function increment() {
    count++
  }

  function birthday() {
    user.age++
  }

  render (
		<h2>Cross-file store</h2>
		<p>count: {count}</p>
		<button onclick={increment}>Increment</button>
		<p>user: {displayName}</p>
		<button onclick={birthday}>Birthday</button>
  )
}

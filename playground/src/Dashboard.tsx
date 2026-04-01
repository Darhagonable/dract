import { count, user, displayName } from "./store"

export component Dashboard() {

  function increment() {
    count++
  }

  function birthday() {
    user.age++
  }

  render (
    <div class="dashboard">
      <h2>Dashboard (cross-file reactivity)</h2>
      <p>Count: {count}</p>
      <button onclick={increment}>Increment</button>
      <hr />
      <p>User: {displayName}</p>
      <p>Age: {user.age}</p>
      <button onclick={birthday}>Birthday 🎂</button>
    </div>
  )
}

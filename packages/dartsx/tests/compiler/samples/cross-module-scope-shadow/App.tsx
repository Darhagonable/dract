import { count, user, resetCount } from './store'
import { watchValue, formatUser } from './utils'

export default component App() {
  state localCount = 0

  watchValue(count, (val) => console.log('store count:', val))

  function handleClick() {
    const count = localCount + 1
    console.log('computed count:', count)
  }

  const processUser = (user: any) => {
    return user.name.toUpperCase()
  }

  render (
    <div>
      <p>Store: {count}</p>
      <p>Local: {localCount}</p>
      <p>User: {formatUser(user)}</p>
      <p>Processed: {processUser(user)}</p>
      <button onclick={() => localCount++}>local++</button>
      <button onclick={() => count++}>store++</button>
      <button onclick={handleClick}>handle</button>
      <button onclick={resetCount}>reset</button>
    </div>
  )
}

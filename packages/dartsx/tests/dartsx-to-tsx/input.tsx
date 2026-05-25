export default component Counter() {
  state name = "world"
  state count = 0
  derived doubled = count * 2

  render (
    <h1>Hello {name}!</h1>
    <input bind:value={name} />
    <button onclick={count++}>
      clicks: {count}
    </button>
    <p>doubled: {doubled}</p>
  )
}

async component Loader() {
  render (
    <p>loaded</p>
  )
}

export component UserCard(bind name: string, age: number, active: boolean = true) {
  export state theme = "light"
  state editing = false

  render (
    <div>
      <span>{name}</span>
      <span>{age}</span>
    </div>
  )
}

export component UserBadge(bind 'display-name' as displayName: string, status: string = 'offline') {
  render (
    <span>{displayName} ({status})</span>
  )
}

component DerivedPatterns() {
  derived { count, increment } = CounterCtx()
  derived { user: { name }, items: [first, { label: itemLabel }] } = loadData()
  derived { user: { name: userName = 'anon' }, ...rest } = loadMore()
  derived [head = 1, ...tail] = getList()
}

component Form() {
  state text = ""
  state checked = false
  state selected = "a"

  render (
    <input bind:value={text} />
    <input type="checkbox" bind:checked={checked} />
    <select bind:value={selected}>
      <option>a</option>
      <option>b</option>
    </select>
    <input bind:{text} />
    <Badge bind:display-name={text} />
  )
}

component ControlFlow() {
  state loading = true
  state error = null as string | null
  state items = [1, 2, 3]
  state status = "active" as string

  render (
    <div>
      {if (loading) (
        <p>Loading...</p>
      ) else if (error) (
        <p>{error}</p>
      ) else (
        <p>Done</p>
      )}

      {if (loading) {
        render <p>Loading...</p>
      } else {
        render <p>Done</p>
      }}

      <ul>
        {for (const item of items) (
          <li>{item}</li>
        )}
      </ul>

      <ul>
        {for (const item of items; key item.id) (
          <li>{item}</li>
        )}
      </ul>

      <ul>
        {for (const item of items; index i; key item.id) (
          <li>{i}: {item}</li>
        )}
      </ul>

      <ul>
        {for (const item of items; key item.id; index i) {
          render <li>{i}: {item}</li>
        }}
      </ul>

      {switch (status) {
        case 'active':
          <span>Active</span>
          break;
        case 'inactive':
          <span>Inactive</span>
          break;
        default:
          <span>Unknown</span>
      }}

      {try {
        render <p>Data</p>
      } catch (e) {
        render <p>Error</p>
      }}

      {try {
        render <p>Data</p>
      } pending {
        render <p>Loading...</p>
      } catch (e) {
        render <p>Error</p>
      }}

      {try (<p>Data</p>) catch (e) (<p>Error</p>)}
    </div>
  )
}

component Events() {
  state count = 0
  state x = 0

  render (
    <button onclick={count++}>increment</button>
    <button onclick={() => console.log('hi')}>log</button>
    <input oninput={(e) => console.log(e.target.value)} />
    <div onclick={x = 5}>assign</div>
    <div onclick={function() { x = 5 }}>fn expr</div>
  )
}

component GenericComponent<T extends Record<string, unknown>>(data: T, label: string) {
  derived keys = Object.keys(data)

  render (
    <div>
      <h2>{label}</h2>
      {for (const key of keys) (
        <span>{key}</span>
      )}
    </div>
  )
}

// Non-DarTsx code should pass through unchanged
function RegularComponent() { return <div>hello</div> }

const obj = { state: 5 }
obj.state = 10

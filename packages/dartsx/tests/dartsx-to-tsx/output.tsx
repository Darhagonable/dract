export default function Counter() {
  let name = "world"
  let count = 0
  const doubled = count * 2

  return (<>
    <h1>Hello {name}!</h1>
    <input bind:value={name} />
    <button onclick={() => count++}>
      clicks: {count}
    </button>
    <p>doubled: {doubled}</p>
  </>)
}

async function Loader() {
  return (
    <p>loaded</p>
  )
}

export function UserCard({name, age, active = true}: {name: string, age: number, active?: boolean}) {
  export let theme = "light"
  let editing = false

  return (
    <div>
      <span>{name}</span>
      <span>{age}</span>
    </div>
  )
}

export function UserBadge({'display-name': displayName, status = 'offline'}: {'display-name': string, status?: string}) {
  return (
    <span>{displayName} ({status})</span>
  )
}

function DerivedPatterns() {
  const { count, increment } = CounterCtx()
  const { user: { name }, items: [first, { label: itemLabel }] } = loadData()
  const { user: { name: userName = 'anon' }, ...rest } = loadMore()
  const [head = 1, ...tail] = getList()
}

function Form() {
  let text = ""
  let checked = false
  let selected = "a"

  return (<>
    <input bind:value={text} />
    <input type="checkbox" bind:checked={checked} />
    <select bind:value={selected}>
      <option>a</option>
      <option>b</option>
    </select>
    <input bind:text={text} />
    <Badge bind:display-name={text} />
  </>)
}

function ControlFlow() {
  let loading = true
  let error = null as string | null
  let items = [1, 2, 3]
  let status = "active" as string

  return (
    <div>
      {(() => { if (loading) { return (
        <p>Loading...</p>
      )} else if (error) { return (
        <p>{error}</p>
      )} else { return (
        <p>Done</p>
      )}})()}

      {(() => { if (loading) {
        return <p>Loading...</p>
      } else {
        return <p>Done</p>
      }})()}

      <ul>
        {(() => { for (const item of items) { return (
          <li>{item}</li>
        )}})()}
      </ul>

      <ul>
        {(() => { for (const item of items) { item.id; return (
          <li>{item}</li>
        )}})()}
      </ul>

      <ul>
        {(() => { for (const item of items) { let i = 0; item.id; return (
          <li>{i}: {item}</li>
        )}})()}
      </ul>

      <ul>
        {(() => { for (const item of items) { let i = 0; item.id; 
          return <li>{i}: {item}</li>
        }})()}
      </ul>

      {(() => { switch (status) {
        case 'active':
          return <span>Active</span>
                
        case 'inactive':
          return <span>Inactive</span>
                
        default:
          return <span>Unknown</span>
      }})()}

      {__try(() => {
        return <p>Data</p>
      }, (e) => {
        return <p>Error</p>
      })}

      {__try(() => {
        return <p>Data</p>
      }, (e) => {
        return <p>Error</p>
      }, () => {
        return <p>Loading...</p>
      })}

      {__try(() => { return (<p>Data</p>) }, (e) => { return (<p>Error</p>) })}
    </div>
  )
}

function Events() {
  let count = 0
  let x = 0

  return (<>
    <button onclick={() => count++}>increment</button>
    <button onclick={() => console.log('hi')}>log</button>
    <input oninput={(e) => console.log(e.target.value)} />
    <div onclick={() => x = 5}>assign</div>
    <div onclick={function() { x = 5 }}>fn expr</div>
  </>)
}

function GenericComponent<T extends Record<string, unknown>>({data, label}: {data: T, label: string}) {
  const keys = Object.keys(data)

  return (
    <div>
      <h2>{label}</h2>
      {(() => { for (const key of keys) { return (
        <span>{key}</span>
      )}})()}
    </div>
  )
}

// Non-DarTsx code should pass through unchanged
function RegularComponent() { return <div>hello</div> }

const obj = { state: 5 }
obj.state = 10

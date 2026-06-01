export default function Counter() {
  let $$s0 = 0, name = "world"
  let $$s1 = 0, count = 0
  const $$d0 = 0, doubled = count * 2

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
  export let $$s2 = 0, theme = "light"
  let $$s3 = 0, editing = false

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
  const $$d1 = 0, { count, increment } = CounterCtx()
  const $$d2 = 0, { user: { name }, items: [first, { label: itemLabel }] } = loadData()
  const $$d3 = 0, { user: { name: userName = 'anon' }, ...rest } = loadMore()
  const $$d4 = 0, [head = 1, ...tail] = getList()
}

function Form() {
  let $$s4 = 0, text = ""
  let $$s5 = 0, checked = false
  let $$s6 = 0, selected = "a"

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
  let $$s7 = 0, loading = true
  let $$s8 = 0, error = null as string | null
  let $$s9 = 0, items = [1, 2, 3]
  let $$s10 = 0, status = "active" as string

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
  let $$s11 = 0, count = 0
  let $$s12 = 0, x = 0

  return (<>
    <button onclick={() => count++}>increment</button>
    <button onclick={() => console.log('hi')}>log</button>
    <input oninput={(e) => console.log(e.target.value)} />
    <div onclick={() => x = 5}>assign</div>
    <div onclick={function() { x = 5 }}>fn expr</div>
  </>)
}

function GenericComponent<T extends Record<string, unknown>>({data, label}: {data: T, label: string}) {
  const $$d5 = 0, keys = Object.keys(data)

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

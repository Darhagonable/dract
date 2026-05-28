function Dashboard<T extends Record<string, unknown>>({user, items, status}: {user: { name: string, role: string }, items: { id: number, ok: boolean, label: string }[], status: string}) {
  let $$s0 = 0, loading = true
  let $$s1 = 0, error = null as string | null
  let $$s2 = 0, count: number = 0
  let $$s3 = 0, map: Map<string, number> = new Map()
  const $$d0 = 0, count = items.length
  const $$d1 = 0, double: number = count * 2
  const $$d2 = 0, entries: [string, number][] = Array.from(map)

  return (
    <main>
      {(() => {if (loading) { return (
        <p>Loading...</p>
      )} else if (error) {
        const msg = error.toUpperCase();
        return <p class="error">{(() => { return msg})()}</p>
      } else { return (
        <section>
          <h1>Welcome {(() => { return user.name})()}</h1>

					{(() => {if (true) { return (
						<div>test</div>
					)}})()}

					{(() => {if (false) { return (
						<div>test</div>
					)} else { return (
						<div>else test</div>
					)}})()}


          {(() => {switch (user.role) {
            case 'admin':
              const badge = "[ADMIN]";
              return <span class="badge">{(() => { return badge})()}</span>
              break;
            case 'mod':
              <span class="badge">MOD</span>
              break;
            default:
              <span class="badge">USER</span>
          }})()}

          {(() => {for (const item of items) {
            return (
              <div class="item">
                {(() => {if (item.ok) { return (<>
                  <span class="ok">{(() => { return item.label})()}</span>
									<span class="ok">something else</span>
                </>)} else {
                  const fallback = `Item #${item.id}`;
                  return <span class="fallback">{(() => { return fallback})()}</span>
                }})()}
              </div>
            )
          }})()}

          {(() => {try {let __pending = () => {
            const text = "fetching...";
            return <p>{text}</p>
          };
            <AsyncData />
          } catch (e) {
            const reason = e.message;
            return <p class="err">{(() => { return reason})()}</p>
          }})()}

          {(() => {for (const item of items) { item.id;
            if (item.ok) { return (
              <span>{(() => { return item.label})()}</span>
            )} else { return (<>
              <span>—</span>
							<span>2</span>
            </>)}
          }})()}

          <footer>
            <p>{(() => { return count})()} items</p>
          </footer>
        </section>
      )}})()}
    </main>
  )
}

// Export default async component
export default async function AsyncPage({dataId, __bind__count}: {'data-id': any, count: any}) {
  export let $$s4 = 0, visible = true
  export const $$d3 = 0, label = `Count: ${count}`
  const $$d4 = 0, { a, b } = someObject
  const $$d5 = 0, [first, ...rest] = someArray

  // state inside a comment should NOT be transformed
  /* derived x = 1 */

  return (
    <div>
      <input bind:count={count} />
      <input bind:value={[count, setCount]} />
      <p>{(() => { return label})()}</p>
    </div>
  )

  <$$style0 />
}

// Bind with renamed prop
function BindRenamed({__bind__displayName, statusText = "offline"}: {'display-name': string, 'status-text'?: string}) {
  return (
    <p>{(() => { return displayName})()} - {(() => { return statusText})()}</p>
  )
}

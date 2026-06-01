function Dashboard<T extends Record<string, unknown>>({user, items, status}: {user: { name: string, role: string }, items: { id: number, ok: boolean, label: string }[], status: string}) {
  let $$s0 = 0, loading = true
  let $$s1 = 0, error = null as string | null
  let $$s2 = 0, count = 0 satisfies number as number
  let $$s3 = 0, map = new Map() satisfies Map<string, number> as Map<string, number>
  const $$d0 = 0, count = items.length
  const $$d1 = 0, double: number = count * 2
  const $$d2 = 0, entries: [string, number][] = Array.from(map)

  return (
    <main>
      {(() => { if (loading) { return (
        <p>Loading...</p>
      )} else if (error) {
        const msg = error.toUpperCase();
        return <p class="error">{msg}</p>
      } else { return (
        <section>
          <h1>Welcome {user.name}</h1>

					{(() => { if (true) { return (
						<div>test</div>
					)}})()}

					{(() => { if (false) { return (
						<div>test</div>
					)} else { return (
						<div>else test</div>
					)}})()}


          {(() => { switch (user.role) {
            case 'admin':
              const badge = "[ADMIN]";
              return <span class="badge">{badge}</span>
              break;
            case 'mod':
              return <span class="badge">MOD</span>
                    
            default:
              return <span class="badge">USER</span>
          }})()}

          {(() => { for (const item of items) {
            return (
              <div class="item">
                {(() => { if (item.ok) { return (<>
                  <span class="ok">{item.label}</span>
									<span class="ok">something else</span>
                </>)} else {
                  const fallback = `Item #${item.id}`;
                  return <span class="fallback">{fallback}</span>
                }})()}
              </div>
            )
          }})()}

          {__try(() => {
            <AsyncData />
          }, (e) => {
            const reason = e.message;
            return <p class="err">{reason}</p>
          }, () => {
            const text = "fetching...";
            return <p>{text}</p>
          })}

          {(() => { for (const item of items) { item.id; (() => { 
            if (item.ok) { return (
              <span>{item.label}</span>
            )} else { return (<>
              <span>—</span>
							<span>2</span>
            </>)}
          })()}})()}

          <footer>
            <p>{count} items</p>
          </footer>
        </section>
      )}})()}
    </main>
  )
}

// Export default async component
export default async function AsyncPage({'data-id': dataId, count}: {'data-id': any, count: any}) {
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
      <p>{label}</p>
    </div>
  )

  <$$style0 />
}

// Bind with renamed prop
function BindRenamed({'display-name': displayName, 'status-text': statusText = "offline"}: {'display-name': string, 'status-text'?: string}) {
  return (
    <p>{displayName} - {statusText}</p>
  )
}

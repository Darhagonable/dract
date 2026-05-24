function Dashboard<T extends Record<string, unknown>>(user: { name: string, role: string }, items: { id: number, ok: boolean, label: string }[], status: string) {
  let $$s0 = 0, loading = true
  let $$s1 = 0, error = null as string | null
  let $$s2 = 0, count: number = 0
  let $$s3 = 0, map: Map<string, number> = new Map()
  const $$d0 = 0, count = items.length
  const $$d1 = 0, double: number = count * 2
  const $$d2 = 0, entries: [string, number][] = Array.from(map)

  return (
    <main>
      {__if(() => (loading), () => (
        <p>Loading...</p>
      ), () => __if(() => (error), () => {
        const msg = error.toUpperCase();
        return <p class="error">{msg}</p>
      }, () => (
        <section>
          <h1>Welcome {user.name}</h1>

					{__if(() => (true), () => (
						<div>test</div>
					))}

					{__if(() => (false), () => (
						<div>test</div>
					), () => (
						<div>else test</div>
					))}


          {__switch(() => (user.role),
            ['admin'], () => {
              const badge = "[ADMIN]";
              return <span class="badge">{badge}</span>
            },
            ['mod'], () =>
              <span class="badge">MOD</span>,
            null, () =>
              <span class="badge">USER</span>
          )}

          {__for(() => (items), (item) => {
            return (
              <div class="item">
                {__if(() => (item.ok), () => (<>
                  <span class="ok">{item.label}</span>
									<span class="ok">something else</span>
                </>), () => {
                  const fallback = `Item #${item.id}`;
                  return <span class="fallback">{fallback}</span>
                })}
              </div>
            )
          })}

          {__try(() => {
            <AsyncData />
          }, (e) => {
            const reason = e.message;
            return <p class="err">{reason}</p>
          }, () => {
            const text = "fetching...";
            return <p>{text}</p>
          })}

          {__for(() => (items), (item) => {
            __if(() => (item.ok), () => (
              <span>{item.label}</span>
            ), () => (<>
              <span>—</span>
							<span>2</span>
            </>))
          },
            (item) => (item.id)
          )}

          <footer>
            <p>{count} items</p>
          </footer>
        </section>
      )))}
    </main>
  )
}

// Export default async component
export default async function AsyncPage(dataId, __bind__count) {
  export let $$s4 = 0, visible = true
  export const $$d3 = 0, label = `Count: ${count}`
  const $$d4 = 0, { a, b } = someObject
  const $$d5 = 0, [first, ...rest] = someArray

  // state inside a comment should NOT be transformed
  /* derived x = 1 */

  return (
    <div>
      <input bind:value={count} />
      <input bind:value={[count, setCount]} />
      <p>{label}</p>
    </div>
  )

  <$$style0 />
}

// Bind with renamed prop
function BindRenamed(__bind__displayName: string, statusText: string = "offline") {
  return (
    <p>{displayName} - {statusText}</p>
  )
}

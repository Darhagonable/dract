component Dashboard<T extends Record<string, unknown>>(user: { name: string, role: string }, items: { id: number, ok: boolean, label: string }[], status: string) {
  state loading = true
  state error = null as string | null
  state count: number = 0
  state map: Map<string, number> = new Map()
  derived count = items.length
  derived double: number = count * 2
  derived entries: [string, number][] = Array.from(map)

  if (status === 'loading') render <p class="status">Loading…</p>
  if (status === 'broken') render (
    <p class="status">{status}</p>
  ) else render <p class="status">Ready</p>

  render (
    <main>
      {if (loading) (
        <p>Loading...</p>
      ) else if (error) {
        const msg = error.toUpperCase();
        render <p class="error">{msg}</p>
      } else (
        <section>
          <h1>Welcome {user.name}</h1>

					{if (true) (
						<div>test</div>
					)}

					{if (false) (
						<div>test</div>
					) else (
						<div>else test</div>
					)}


          {switch (user.role) {
            case 'admin':
              const badge = "[ADMIN]";
              render <span class="badge">{badge}</span>
              break;
            case 'mod':
              <span class="badge">MOD</span>
              break;
            default:
              <span class="badge">USER</span>
          }}

          {for (const item of items) {
            render (
              <div class="item">
                {if (item.ok) (
                  <span class="ok">{item.label}</span>
									<span class="ok">something else</span>
                ) else {
                  const fallback = `Item #${item.id}`;
                  render <span class="fallback">{fallback}</span>
                }}
              </div>
            )
          }}

          {try {
            <AsyncData />
          } pending {
            const text = "fetching...";
            render <p>{text}</p>
          } catch (e) {
            const reason = e.message;
            render <p class="err">{reason}</p>
          }}

          {for (const item of items; key item.id) {
            if (item.ok) (
              <span>{item.label}</span>
            ) else (
              <span>—</span>
							<span>2</span>
            )
          }}

          <footer>
            <p>{count} items</p>
          </footer>
        </section>
      )}
    </main>
  )
}

// Export default async component
export default async component AsyncPage('data-id' as dataId, bind count) {
  export state visible = true
  export derived label = `Count: ${count}`
  derived { a, b } = someObject
  derived [first, ...rest] = someArray

  // state inside a comment should NOT be transformed
  /* derived x = 1 */

  render (
    <div>
      <input bind:{count} />
      <input bind:value={count, setCount} />
      <p>{label}</p>
    </div>
  )

  <style>
    div { color: red; }
  </style>
}

// Bind with renamed prop
component BindRenamed(bind 'display-name' as displayName: string, 'status-text' as statusText: string = "offline") {
  render (
    <p>{displayName} - {statusText}</p>
  )
}

// render as the contextual keyword: every render below sits in statement
// position (where a return would be legal) and must be rewritten to return —
// block start, after ; and }, brace-less control bodies, else, and ASI
// newlines after statement-complete tokens (including JSX, ++, regexes).
component RenderKeywordMatrix(cond, xs, i) {
  render <p>block start</p>
  const a = 1; render (<p/>)
  function helper() { work() }
  render (<p/>)
  if (cond) render (<p/>)
  if (cond)
  render (<p/>)
  for (const x of xs) render (<p/>)
  while (cond) render (<p/>)
  if (a) {
  } else render <p>no</p>
  const done = true
  render (<p>{done}</p>)
  if (a) render <p>no</p>
  render (<p>yes</p>)
  i++
  render (<p/>)
  const re = /[(]/g
  render (<p/>)
  const re2 = /["']/g
  render (<p/>)
  const q = f(a) / 2
  render (<p/>)
  render (<DataTable row={(r) => <tr>{r}</tr>} />)
}

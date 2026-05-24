component Dashboard<T extends Record<string, unknown>>(user: { name: string, role: string }, items: { id: number, ok: boolean, label: string }[], status: string) {
  state loading = true
  state error = null as string | null
  state count: number = 0
  state map: Map<string, number> = new Map()
  derived count = items.length
  derived double: number = count * 2
  derived entries: [string, number][] = Array.from(map)

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

// Event-handler arrow bodies that OPEN with control flow must compile to
// plain JavaScript: wrapping them into reactive $.if/$.for blocks both makes
// the branches lazily reactive and silently drops every statement after the
// first. The rename-blur pattern below is the canonical regression.
component App() {
  state count = 0
  state log: string[] = []

  render (
    <div>
      <button
        onclick={() => {
          if (count === 0) count = 1
          else count = 0
          log.push('clicked')
        }}
      >
        toggle
      </button>
      <button
        onclick={() => {
          for (let i = 0; i < 3; i++) log.push('i' + i)
          log.push('done')
        }}
      >
        loop
      </button>
      <button
        onclick={() => {
          try {
            log.push('tried')
          } catch (e) {
            log.push('failed')
          }
          log.push('after')
        }}
      >
        try
      </button>
      {/* Control-flow holes beside the handlers must keep their wraps.
          (Paren body = implicit render; a {} block body would need an
          explicit `render` statement per the block-body rule.) */}
      {if (count > 0) (<p>{count}</p>)}
      {for (const entry of log; key entry) (
        <li>{entry}</li>
      )}
    </div>
  )
}

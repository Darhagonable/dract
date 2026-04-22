component Test() {
  derived items = [{ ok: true, a: 'x', b: 'y' }]

  render (
    {for (const item of items) {
      <div>
        {if (item.ok) {
          <span>{item.a}</span>
          <span>{item.b}</span>
        }}
      </div>
    }}
  )
}

component App() {
  state items = [{name: 'a'}, {name: 'b'}, {name: 'c'}]
  render (
    <div>
      {
        const filtered = items.filter((i) => i.name !== 'a')
        for (const item of filtered) {
          <p>{item.name}</p>
        }
      }
    </div>
  )
}

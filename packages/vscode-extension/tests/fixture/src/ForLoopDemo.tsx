export component ForLoopDemo() {
  state items = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]

  render (
    <ul>
      {for (const item of items; key item.id; index i) (
        <li>{i}: {item.name}</li>
      )}
    </ul>
  )
}

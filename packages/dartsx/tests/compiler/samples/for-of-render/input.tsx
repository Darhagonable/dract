component App() {
  state items = [{name: "a"}, {name: "b"}, {name: "c"}]
  render (
    <ul>
      {for (const item of items) {
        const name = item.name;
        render <li>{name}</li>
      }}
    </ul>
  )
}

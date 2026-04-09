component List() {
  state items = ['a', 'b', 'c']
  render (
    <ul>
      {for (const item of items) {
        render <li>{item}</li>
      }}
    </ul>
    <style>
      li { padding: 4px; }
    </style>
  )
}

function search(query: string): string[] {
  if (!query.trim()) return [];
  return [query];
}

component SearchBox() {
  state query = ''
  derived results = search(query)

  render (
    <ul>
      {for (const r of results) {
        <li>{r}</li>
      }}
    </ul>
  )
}

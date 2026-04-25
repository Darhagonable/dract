component Search() {
  state query = ''
  state results = []

  function doSearch() {
    for (let i = 0; i < results.length; i++) {
      const query = results[i].text
      console.log(query.toLowerCase())
    }
    for (const query of getQueries()) {
      fetch(`/api?q=${query}`)
    }
  }

  render (
    <div>
      <input value={query} />
      <button onclick={doSearch}>search</button>
      <p>{results.length} results for "{query}"</p>
    </div>
  )
}

component App() {
  state mode = 'a'
  render (
    <div>
      {if (mode === 'a') {
        if (mode === 'a') {
          <p>Nested A</p>
        } else {
          <p>Nested B</p>
        }
      } else {
        <span>Fallback</span>
      }}
    </div>
  )
}

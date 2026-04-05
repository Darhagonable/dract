component App() {
  render (
    <div>
      {try {
        <p>Content</p>
      } pending {
        <p>Loading...</p>
      } catch (err) {
        <p>Failed</p>
      }}
    </div>
  )
}

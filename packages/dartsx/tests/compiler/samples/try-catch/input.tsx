component App() {
  render (
    <div>
      {try {
        <p>Content</p>
      } catch (e) {
        <p>Error occurred</p>
      }}
    </div>
  )
}

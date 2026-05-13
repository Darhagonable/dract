component App() {
  state loaded = false
  render (
    <div>
      {if (loaded) (
        <p>Content</p>
      )}
    </div>
  )
}

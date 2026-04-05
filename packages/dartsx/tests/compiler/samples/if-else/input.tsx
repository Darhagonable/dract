component App() {
  state show = true
  render (
    <div>
      {if (show) {
        <p>Visible</p>
      } else {
        <span>Hidden</span>
      }}
    </div>
  )
}

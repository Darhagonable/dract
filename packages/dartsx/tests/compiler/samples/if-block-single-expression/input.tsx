component App() {
  state count = 0
  render (
    <div>
      {if (count > 0) {
        <span>{count} items</span>
      } else {
        <span>no items</span>
      }}
    </div>
  )
}

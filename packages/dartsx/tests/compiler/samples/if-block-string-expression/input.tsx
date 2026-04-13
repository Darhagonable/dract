component App() {
  state count = 0
  render (
    <div>
      {if (count > 0) {
        "has items"
      } else {
        "no items"
      }}
    </div>
  )
}

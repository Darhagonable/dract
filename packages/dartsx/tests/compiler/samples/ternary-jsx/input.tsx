component App() {
  state show = true
  render (
    <div>
      {show ? <p>Visible</p> : <span>Hidden</span>}
    </div>
  )
}

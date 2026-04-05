component App() {
  state show = true
  render (
    <div>
      {show ? <p>Visible</p> : null}
    </div>
  )
}

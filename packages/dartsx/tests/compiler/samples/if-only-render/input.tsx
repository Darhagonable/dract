component App() {
  state show = true
  render (
    <div>
      {if (show) {
        const msg = "visible";
        render <p>{msg}</p>
      }}
    </div>
  )
}

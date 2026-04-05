component App() {
  state show = true
  render (
    <div>
      {if (show) {
        const msg = "visible";
        render <p>{msg}</p>
      } else {
        const msg = "hidden";
        render <span>{msg}</span>
      }}
    </div>
  )
}

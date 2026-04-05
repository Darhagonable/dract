component App() {
  state mode = true
  render (
    <div>
      {if (mode)
        <p>On</p>
      else
        <p>Off</p>
      }
    </div>
  )
}

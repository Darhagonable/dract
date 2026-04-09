component StyledComponent() {
  render (
    <div>
      <p>Outside</p>
      <div>
        <p>Inside</p>
        <style>
          p { color: green; }
        </style>
      </div>
    </div>
    <style>
      p { color: red; }
    </style>
  )
}

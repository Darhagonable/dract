component Parent(children) {
  render (
    <div>
      <p>Parent text</p>
      {children}
    </div>
    <style>
      p { color: red; }
    </style>
  )
}

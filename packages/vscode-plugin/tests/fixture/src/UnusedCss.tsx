export component UnusedCssDemo() {
  render (
    <div>
      <p class="used">Hello</p>
    </div>
  )

  <style>
    .used { color: red; }
    .unused-selector { color: blue; }
  </style>
}

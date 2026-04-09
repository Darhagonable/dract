component Button(color: string) {
  state size = 16
  render (
    <button>Click me</button>
    <style>
      button {
        color: {color};
        font-size: {size}px;
        padding: {size / 2}px {size}px;
      }
    </style>
  )
}

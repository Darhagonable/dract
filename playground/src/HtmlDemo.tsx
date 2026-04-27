export component HtmlDemo() {
  state markup = "<em>Hello</em> from <code>{@html}</code>!"

  render (
    <div>
      <h3>Raw HTML Demo</h3>
      <div>{@html markup}</div>
      <input bind:value={markup} style="width:100%" />
    </div>
  )
}

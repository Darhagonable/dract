component Widget() {
  render (
    <div>
      <p>Content</p>
    </div>
    <style>
      p { color: red; }
      :global(body) { margin: 0; }
      div > p { font-size: 14px; }
      h1, h2 { font-weight: bold; }
      ul li:first-child { color: blue; }
      p::before { content: '> '; }
    </style>
  )
}

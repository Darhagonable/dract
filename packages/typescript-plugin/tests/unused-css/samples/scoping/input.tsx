// Scoping: <style global>, :global(), :deep(), nested style blocks

export component GlobalStyleBlock() {
  render (
    <div>
      <p>Content</p>
    </div>
    <style global>
      body { margin: 0; }
      .external { color: red; }
    </style>
    <style>
      p { color: red; }
      .unused { color: blue; }
    </style>
  )
}

export component GlobalSelector() {
  render (
    <div>
      <p>Content</p>
    </div>
    <style>
      p { color: red; }
      :global(body) { margin: 0; }
      :global(.modal) { z-index: 100; }
    </style>
  )
}

export component DeepSelector() {
  render (
    <div class="wrapper">
      <Child />
    </div>
    <style>
      .wrapper { padding: 16px; }
      .wrapper :deep(.child-title) { color: red; }
      :deep(.other) { color: blue; }
    </style>
  )
}

export component NestedStyleBlocks() {
  render (
    <section class="outer">
      <h2>Title</h2>
      <p>Outer paragraph</p>
      <div class="inner-box">
        <p>Inner paragraph</p>
        <span>inner span</span>
        <style>
          p { color: green; }
          h2 { color: red; }
        </style>
      </div>
    </section>
    <style>
      .outer { padding: 24px; }
      h2 { font-size: 22px; }
      p { color: red; }
      .inner-box { background: #f8f; }
      .not-used { color: blue; }
    </style>
  )
}

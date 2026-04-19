// Edge cases: JSX comment phantom tags, dynamic class expressions

export component JsxCommentPhantom() {
  render (
    <div class="real">
      {/* This comment mentions <span> and .fake but they are not real elements */}
      <p>Content</p>
    </div>
    <style>
      .real { color: red; }
      p { font-size: 14px; }
      span { display: inline; }
      .fake { color: blue; }
    </style>
  )
}

export component DynamicClass() {
  state active = true

  render (
    <div class={active ? "on" : "off"}>
      <span class="static">text</span>
    </div>
    <style>
      .on { color: green; }
      .off { color: gray; }
      .static { font-size: 14px; }
      .dynamic-missing { color: red; }
    </style>
  )
}

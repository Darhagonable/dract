// Basic unused CSS: classes, tags, IDs, self-closing, multiple classes

export component UnusedClass() {
  render (
    <div class="foo">hello</div>
    <style>
      .foo { color: red; }
      .bar { color: blue; }
    </style>
  )
}

export component UnusedTag() {
  render (
    <div>
      <h1>Title</h1>
      <p>Content</p>
    </div>
    <style>
      h1 { color: red; }
      p { font-size: 14px; }
      h2 { color: blue; }
      span { display: inline; }
    </style>
  )
}

export component NoWarnings() {
  render (
    <div class="card">
      <h2>Title</h2>
      <p class="text">Content</p>
    </div>
    <style>
      .card { border: 1px solid; }
      h2 { color: red; }
      .text { font-size: 14px; }
      div { padding: 8px; }
    </style>
  )
}

export component UnusedId() {
  render (
    <div id="app">
      <h1 id="title">Title</h1>
    </div>
    <style>
      #app { padding: 8px; }
      #title { color: red; }
      #missing { color: blue; }
    </style>
  )
}

export component MultipleClasses() {
  render (
    <div class="a b c">multiple classes</div>
    <p class="d">single class</p>
    <style>
      .a { color: red; }
      .b { color: green; }
      .c { color: blue; }
      .d { color: purple; }
      .e { color: orange; }
    </style>
  )
}

export component SelfClosing() {
  render (
    <div>
      <input type="text" />
      <br />
      <img src="test.png" />
    </div>
    <style>
      input { border: 1px solid; }
      br { margin: 4px; }
      img { max-width: 100%; }
      textarea { resize: none; }
    </style>
  )
}

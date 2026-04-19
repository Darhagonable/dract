// Selector types: comma-separated, combinators, attribute selectors, pseudo-elements

export component CommaSeparated() {
  render (
    <div>
      <h1>Title</h1>
      <p>Content</p>
    </div>
    <style>
      h1, .missing { color: red; }
      h1, p { font-size: 14px; }
    </style>
  )
}

export component Combinator() {
  render (
    <div class="parent">
      <p class="child">Child</p>
      <span>Sibling</span>
    </div>
    <style>
      .parent > .child { color: red; }
      .parent span { display: inline; }
      .parent > .missing { color: blue; }
      .nope > .child { color: green; }
    </style>
  )
}

export component AttributeSelector() {
  render (
    <div>
      <input type="color" />
      <input type="text" />
    </div>
    <style>
      input[type="color"] { width: 32px; }
      input[type="text"] { padding: 4px; }
      input[type="range"] { accent-color: red; }
    </style>
  )
}

export component PseudoElements() {
  render (
    <div>
      <ul>
        <li class="active">Item</li>
      </ul>
      <p class="text">Paragraph</p>
    </div>
    <style>
      li:first-child { font-weight: bold; }
      li::before { content: "→ "; }
      .active:hover { color: red; }
      p::after { content: "!"; }
      .text:focus { outline: none; }
      .missing:hover { color: blue; }
      span::before { content: "x"; }
    </style>
  )
}

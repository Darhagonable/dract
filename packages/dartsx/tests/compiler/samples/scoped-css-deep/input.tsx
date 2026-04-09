component Parent() {
  render (
    <div>
      <p>Styled</p>
    </div>
    <style>
      div { padding: 16px; }
      .wrapper :deep(.child-title) { color: red; }
      :deep(.inner) { font-size: 12px; }
    </style>
  )
}

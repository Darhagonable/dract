// Demonstrates: scoped styles, :deep(), children prop scoping
export component StyledPanel(children, title: string = "Panel") {
  state collapsed = false

  render (
    <div class="panel">
      <div class="panel-header" onclick={() => collapsed = !collapsed}>
        <h4>{title}</h4>
        <span class="toggle">{collapsed ? "▸" : "▾"}</span>
      </div>
      {if (!collapsed) (
        <div class="panel-body">{children}</div>
      )}
    </div>
    <style>
      .panel {
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        overflow: hidden;
      }

      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: #f8fafc;
        cursor: pointer;
        user-select: none;
      }

      .panel-header:hover { background: #f1f5f9; }

      h4 { margin: 0; font-size: 14px; }

      .toggle { font-size: 12px; color: #94a3b8; }

      .panel-body { padding: 12px; }

      /* :deep() — style child component internals */
      .panel-body :deep(.theme-card) {
        border-style: dashed;
      }
    </style>
  )
}

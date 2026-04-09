// Demonstrates: scoped @media queries, complex selectors, pseudo-elements
export component StatusList() {
  state items = [
    { label: "Build", ok: true },
    { label: "Tests", ok: true },
    { label: "Deploy", ok: false },
  ]

  render (
    <div class="status-list">
      <h4>Status</h4>
      <ul>
        {for (const item of items) {
          render <li class={item.ok ? "ok" : "fail"}>{item.label}</li>
        }}
      </ul>
    </div>
    <style>
      .status-list { font-family: monospace; }

      h4 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }

      ul { list-style: none; padding: 0; margin: 0; }

      li {
        padding: 6px 8px;
        border-radius: 4px;
        font-size: 13px;
      }

      li::before { margin-right: 6px; }

      li.ok { color: #16a34a; }
      li.ok::before { content: "✓"; }

      li.fail { color: #dc2626; }
      li.fail::before { content: "✗"; }

      ul li:first-child { border-top: none; }

      /* responsive */
      @media (max-width: 600px) {
        li { font-size: 11px; padding: 4px 6px; }
      }
    </style>
  )
}

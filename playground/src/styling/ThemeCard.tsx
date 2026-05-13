// Demonstrates: reactive CSS values {expr}, @keyframes scoping, :deep()
export component ThemeCard(accentColor: string = "#6366f1") {
  state hovered = false

  render (
    <div
      class="theme-card"
      onmouseenter={() => hovered = true}
      onmouseleave={() => hovered = false}
    >
      <h3>Theme Card</h3>
      <p class="description">This card uses reactive CSS values.</p>
      <p class="accent-label">Accent: <code>{accentColor}</code></p>
      <div class="swatch" />
      {if (hovered) (
        <span class="badge">Hovered!</span>
      )}
    </div>
    <style>
      .theme-card {
        border: 2px solid {accentColor};
        border-radius: 8px;
        padding: 16px;
        transition: box-shadow 0.2s;
        animation: cardEnter 0.3s ease-out;
      }

      h3 {
        margin: 0 0 8px;
        color: {accentColor};
      }

      .description { color: #666; font-size: 14px; }

      .accent-label code {
        background: {accentColor};
        color: white;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
      }

      .swatch {
        width: 100%;
        height: 8px;
        border-radius: 4px;
        background: {accentColor};
        margin-top: 12px;
      }

      .badge {
        display: inline-block;
        margin-top: 8px;
        padding: 2px 8px;
        background: {accentColor};
        color: white;
        border-radius: 12px;
        font-size: 12px;
        animation: fadeIn 0.2s;
      }

      @keyframes cardEnter {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
    </style>
  )
}

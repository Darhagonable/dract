import { ThemeCard } from "./ThemeCard";
import { StyledPanel } from "./StyledPanel";
import { StatusList } from "./StatusList";

/**
 * Showcases all scoped CSS features:
 * - Basic scoped styles
 * - Reactive CSS values {expr}
 * - :global() for resets
 * - :deep() for child component styling
 * - @keyframes scoping
 * - @media queries
 * - Complex selectors (combinators, pseudo-elements, comma-separated)
 * - Control flow inside scoped components
 * - Children/slot scoping
 * - Mixed scoped + global styles
 * - Nested style blocks
 */
export component StyleShowcase() {
  state accent = "#6366f1"

  render (
    <section class="showcase">
      <h2>Scoped CSS Showcase</h2>
      <p class="subtitle">Every feature of the scoped styling system.</p>

      {/* Color picker — drives reactive CSS values in ThemeCard */}
      <div class="color-row">
        <label>
          Accent color:
          <input type="color" bind:value={accent} />
          <code>{accent}</code>
        </label>
      </div>

      <div class="grid">
        {/* Reactive CSS values + @keyframes */}
        <ThemeCard accentColor={accent} />

        {/* :deep() + children scoping */}
        <StyledPanel title="Nested Panel">
          <ThemeCard accentColor="#ec4899" />
        </StyledPanel>

        {/* @media + complex selectors + control flow */}
        <StyledPanel title="Build Status">
          <StatusList />
        </StyledPanel>
      </div>

      {/* Nested style block — inner <p> gets green, outer stays scoped red */}
      <div class="nested-demo">
        <p>Outer paragraph (red from outer style)</p>
        <div class="inner-box">
          <p>Inner paragraph (green from nested style)</p>
          <style>
            p { color: #16a34a; font-weight: 600; }
          </style>
        </div>
      </div>
    </section>

    {/* Scoped styles for this component */}
    <style>
      .showcase {
        max-width: 720px;
        margin: 0 auto;
        padding: 24px;
      }

      h2 {
        margin: 0;
        font-size: 22px;
        color: #1e293b;
      }

      .subtitle {
        margin: 4px 0 20px;
        color: #64748b;
        font-size: 14px;
      }

      .color-row {
        margin-bottom: 20px;
      }

      .color-row label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: #475569;
      }

      .color-row input[type="color"] {
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }

      .color-row code {
        background: #f1f5f9;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 12px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
        margin-bottom: 24px;
      }

      .nested-demo {
        border: 1px dashed #cbd5e1;
        border-radius: 6px;
        padding: 12px;
      }

      .nested-demo > p { color: #dc2626; }

      .inner-box {
        margin-top: 8px;
        padding: 8px;
        background: #f8fafc;
        border-radius: 4px;
      }
    </style>

    {/* Global reset — demonstrates mixed scoped + global */}
    <style global>
      *, *::before, *::after { box-sizing: border-box; }
    </style>
  )
}

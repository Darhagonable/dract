import { syncToStorage, readFromStorage } from './sync-to-storage';

export component StorageSyncDemo() {
  state username = "alice";
  state theme = "dark";

  // These pass state variables to syncToStorage — positions 1 receives a signal.
  // syncToStorage forwards the signal to effect() internally.
  // BUG: The Vite plugin sees position 1 is reactive, recompiles sync-to-storage.ts,
  // and wraps reads of `value` with $.get(). Now effect($.get(value), ...) receives
  // a plain string instead of a Signal — effect throws "invalid dependency".
  syncToStorage("demo-username", username);
  syncToStorage("demo-theme", theme);

  derived stored = readFromStorage("demo-username") ?? "(nothing)";

  render (
    <div>
      <h3>Storage Sync Demo (cross-file signal forwarding bug)</h3>
      <label>
        Username:
        <input value={username} oninput={(e) => username = e.currentTarget.value} />
      </label>
      <label>
        Theme:
        <select value={theme} onchange={(e) => theme = e.currentTarget.value}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
      <p>Last stored username: {stored}</p>
    </div>
  )
}

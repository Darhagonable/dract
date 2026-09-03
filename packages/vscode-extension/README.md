# DarTsx — VS Code Extension

User-facing DarTsx editor support for JavaScript, TypeScript, JSX, and TSX files.

DarTsx is a fresh frontend framework using JSX-like syntax with Flow-style component syntax, two-way binding via `bind:`, and signals with the `state` and `derived` keywords.

## Features

- **Syntax highlighting** for DarTsx syntax in `.js`, `.jsx`, `.ts`, and `.tsx` files, injected into VS Code's built-in JS/TS grammars — `state` and `derived` color like `let`/`const`, `component` like a declaration, consistently across all four languages
- **CSS language features** inside `<style>` blocks (diagnostics, completions, hover) powered by the Volar language server
- **TypeScript integration** — the extension ships an embedded DarTsx language service that loads into VS Code's built-in TS server: diagnostics, completions, hover, and go-to-definition work out of the box, without requiring you to be inside a TypeScript project

Works with VS Code's built-in JavaScript/TypeScript language service, so nothing extra needs to be installed or configured.

## Desktop & Web

The extension runs both on desktop VS Code and in web contexts (vscode.dev / github.dev). On the web it provides syntax highlighting; CSS language features are desktop-only.

## Getting Started

Install the extension from the marketplace and open any `.ts`/`.tsx` file containing DarTsx components:

```tsx
component Counter(start: number = 0) {
	state count = start
	derived double = count * 2

	render(
		<button bind:{count}>{double}</button>
	)
}
```

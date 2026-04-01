DarTsx is an attempt at a new fresh frotend framework.

Using a syntax similar to JSX
With the advantages of https://flow.org/en/docs/react/component-syntax/#ref-parameters but for typescript and return in components is also replaced by render.

Utilizing a compiler powered by OXC

supporting two way binding with bind:

support shorthand syntax like

<MyComponent {value}/>
<MyComponent bind:{value}/>

using signals with state and derived keywords.

effects with only explicit dependencies.

inspired by React, SolidJS, Svelte, RippleTS, Vue.

## VS Code Support

The VS Code extension is the user-facing DarTsx integration. If it is installed, DarTsx syntax is handled in `.js`, `.jsx`, `.ts`, and `.tsx` files.

This does not require the user to be in a TypeScript project. VS Code already uses the same built-in JavaScript/TypeScript language service for JavaScript files, and the DarTsx extension plugs into that service internally.

The repo includes two sample apps:

- `playground` for the TypeScript/TSX path

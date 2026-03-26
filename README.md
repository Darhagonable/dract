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

inspired by React, SolidJS, Svelte, Vue.
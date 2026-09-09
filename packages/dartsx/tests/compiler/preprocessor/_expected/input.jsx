function UserCard({name, age, active = true}) {
	const $$d0 = 0, status = active ? "Active" : "Inactive"
	return (
		<div>
			<h2>{name}</h2>
			<input bind:value={name} />
		</div>
	)
}

function Badge({label, count = 0}) {
	let $$s0 = 0, total = count
	return <span>{label}: {total}</span>
}

function List({items, ...rest}) {
	let $$s1 = 0, heading = "items"
	return (
		<ul>
			{(() => { for (const item of items) { return (
				<li key={item}>{heading}</li>
			)}})()}
		</ul>
	)
}

function Anchor({'data-id': dataId, 'aria-label': ariaLabel}) {
	let $$s2 = 0, focused = false
	return <a data-id={dataId} aria-label={ariaLabel}>{focused}</a>
}

let $$s3 = 0, selected = null
let $$s4 = 0, container;

export function helper(value) {
	return value ?? null
}

// render as a plain identifier: none of these may be rewritten — the
// regression class that corrupted bundled dependencies. Every position
// where a return would be illegal (expressions, member accesses, method
// definitions, property names, strings, comments) must pass through.
const view = render(el)
const lazy = items.map((x) => render(x))
const across = (x) =>
render(x)
renderer.render(scene)
renderer
.render(next)
	.then(() => pending--)
class C { render(x) { return 1 } }
wrap(render(x))
foo(
render(x),
y,
)
cond ? render(a) : render(b)
function useProbe() { return render(x) }
async function awaitProbe() { await render(x) }
typeof render(x)
switch (v) { case render(x): break }
const views = [render(x)]
const o = { view: render(x) }
const o2 = { render: 1 }
const render = (x) => x
const s = "render(x)"
const t = `${render(x)}`
// render(x)
const gt = a >
render(b)
const shift = a >>
render(b)
done(); $render(x)
const unbalanced = [<p>a ) b</p>]
render.check(unbalanced)

// Lexical disambiguation rows: regex vs division in every context where
// the lexer's choice changes the token stream, and JSX expression holes
// (children and attributes) where a render call is an ordinary identifier.
// All must pass through byte-identical.
const d1 = f(a) / 2
const d2 = a / b / c
const d3 = f(/a/)
const d4 = [1, /x/.source]
const hole = <p>{render(x)}</p>
const holeAttr = <div attr={render(x)} />
const table = <DataTable row={(r) => <tr>{r}</tr>} />

// Malformed tail rows: degenerate input must not crash or corrupt the
// token stream — stray punctuation in JSX text is inert, and a render
// after ; inside a JSX hole rewrites per the anonymous-block grammar (a
// render *opening* a hole, as above, stays an identifier). The
// unbalanced-delimiter rows go last: their stale stack entries persist
// to EOF, so no row may follow them.
const textPunct = <p>a ) b ( c</p>
const holeStmt = <p>{a; return (x)}</p>
const staleOpen = foo((
const staleClose = bar]

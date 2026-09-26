// Event-handler arrow bodies and other plain-JavaScript blocks that OPEN with
// control flow must pass through the preprocessor untouched: wrapping them
// into control-flow IIFEs turns eager handler code into reactive `$.if`
// blocks and drops every statement after the first. Only JSX expression
// holes (`{if …}` containers) get the wrap.
export function Handlers() {
	let $$s0 = 0, count = 0
	let $$s1 = 0, log = [] satisfies string[] as string[]

	return (
		<div>
			{/* Handler block opening with if + trailing statement — the rename
			    pattern. Nothing here may become an IIFE. */}
			<button
				onclick={() => {
					if (count === 0) count = 1
					else count = 0
					log.push('clicked')
				}}
			>
				toggle
			</button>

			{/* Handler block opening with a for loop */}
			<button
				onclick={() => {
					for (let i = 0; i < 3; i++) log.push('i' + i)
					log.push('done')
				}}
			>
				loop
			</button>

			{/* Handler block opening with switch */}
			<button
				onclick={() => {
					switch (count) {
						case 0:
							log.push('zero')
							break
						default:
							log.push('other')
					}
					log.push('tail')
				}}
			>
				switch
			</button>

			{/* Handler block opening with try — must not become __try */}
			<button
				onclick={() => {
					try {
						log.push('tried')
					} catch (e) {
						log.push('failed')
					}
					log.push('after-try')
				}}
			>
				try
			</button>

			{/* A while-consequence block opening with if — plain JavaScript */}
			<button
				onclick={() => {
					let n = 0
					while (n < 2) {
						if (n === 1) log.push('one')
						n++
					}
				}}
			>
				while
			</button>

			{/* Nested if inside a handler, block body */}
			<button
				onclick={() => {
					if (count > 0) {
						if (count > 1) log.push('many')
						else log.push('one')
					}
				}}
			>
				nested
			</button>

			{/* Render-prop arrow whose JSX contains a REAL control-flow hole:
			    the hole must still be wrapped, the arrow body must not. */}
			<Panel footer={(item: string) => {
				if (item === 'x') return <em>{item}</em>
				return <span>{item}</span>
			}} />

			{/* Legit control-flow holes right next to the handlers, proving the
			    wrap still fires where it must. */}
			{(() => { if (count > 0) { return (<p>{count}</p>)}})()}
			{(() => { for (const entry of log) { entry; 
				<li>{entry}</li>
			}})()}
		</div>
	)
}

function Panel({footer}: {footer: any}) {
	return <section>{footer('x')}</section>
}

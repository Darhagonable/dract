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

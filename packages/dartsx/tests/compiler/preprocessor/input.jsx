component UserCard(bind name, age, active = true) {
	derived status = active ? "Active" : "Inactive"
	render (
		<div>
			<h2>{name}</h2>
			<input bind:value={name} />
		</div>
	)
}

component Badge(label, count = 0) {
	state total = count
	render <span>{label}: {total}</span>
}

component List(items, ...rest) {
	state heading = "items"
	render (
		<ul>
			{for (const item of items) (
				<li key={item}>{heading}</li>
			)}
		</ul>
	)
}

component Anchor('data-id' as dataId, bind 'aria-label' as ariaLabel) {
	state focused = false
	render <a data-id={dataId} aria-label={ariaLabel}>{focused}</a>
}

state selected = null
state container;

export function helper(value) {
	return value ?? null
}

export component ForBasic() {
	state items = [
		{ text: "Item 1" },
		{ text: "Item 2" },
		{ text: "Item 3" },
	];

	render (
		<ul>
			{for (const item of items) {
				<li>{item.text}</li>
			}}
		</ul>
	);
}

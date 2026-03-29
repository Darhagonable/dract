function Broken() {
	throw new Error('boom');
}

export component TryCatch() {
	render (
		<div>
			{try {
				<Broken />
			} catch (e) {
				<span>caught</span>
			}}
		</div>
	);
}

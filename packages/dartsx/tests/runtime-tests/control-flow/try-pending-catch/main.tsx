function AsyncContent() {
	const span = document.createElement('span');
	span.textContent = 'done';
	return new Promise((resolve) => {
		setTimeout(() => resolve(span), 10);
	});
}

export component TryPendingCatch() {
	render (
		<div>
			{try {
				<AsyncContent />
			} pending {
				<span>loading</span>
			} catch (e) {
				<span>error</span>
			}}
		</div>
	);
}

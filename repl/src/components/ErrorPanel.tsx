export function renderErrorPanel(error: string | null): HTMLDivElement | null {
	if (!error) return null;

	const container = document.createElement('div');
	container.className = 'error-panel';

	const header = document.createElement('div');
	header.className = 'error-header';
	header.textContent = 'Error';
	container.appendChild(header);

	const message = document.createElement('pre');
	message.className = 'error-message';
	message.textContent = error;
	container.appendChild(message);

	return container;
}

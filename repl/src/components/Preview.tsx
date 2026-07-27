let iframe: HTMLIFrameElement | null = null;
let iframeReady = false;
let pendingMessage: { code: string; css: string } | null = null;

export function mountPreview(parent: HTMLElement): HTMLIFrameElement {
	iframe = document.createElement('iframe');
	iframe.style.width = '100%';
	iframe.style.height = '100%';
	iframe.style.border = 'none';
	iframe.style.background = '#fff';
	iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
	iframe.src = '/preview-shell.html';
	iframe.onload = () => {
		iframeReady = true;
		if (pendingMessage) {
			sendToPreview(pendingMessage.code, pendingMessage.css);
			pendingMessage = null;
		}
	};
	parent.appendChild(iframe);
	return iframe;
}

export function sendToPreview(code: string, css: string) {
	if (!iframe || !iframe.contentWindow) return;
	if (!iframeReady) {
		pendingMessage = { code, css };
		return;
	}
	iframe.contentWindow.postMessage(
		{ type: 'compile', code, css },
		'*',
	);
}

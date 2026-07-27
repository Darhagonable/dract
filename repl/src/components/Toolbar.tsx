export interface ToolbarProps {
	onRun: () => void;
	onShare: () => void;
	onReset: () => void;
	onFormat: () => void;
	isCompiling: boolean;
	hasError: boolean;
}

export function renderToolbar(props: ToolbarProps): HTMLDivElement {
	const container = document.createElement('div');
	container.className = 'toolbar';

	const title = document.createElement('span');
	title.className = 'toolbar-title';
	title.textContent = 'DarTsx REPL';
	container.appendChild(title);

	const actions = document.createElement('div');
	actions.className = 'toolbar-actions';

	const runBtn = createButton('Run', props.onRun, props.isCompiling ? 'compiling' : '');
	runBtn.title = 'Compile & run (Ctrl+Enter)';
	actions.appendChild(runBtn);

	const shareBtn = createButton('Share', props.onShare);
	shareBtn.title = 'Copy shareable URL';
	actions.appendChild(shareBtn);

	const resetBtn = createButton('Reset', props.onReset);
	resetBtn.title = 'Reset to default example';
	actions.appendChild(resetBtn);

	container.appendChild(actions);
	return container;
}

function createButton(text: string, onClick: () => void, extraClass = ''): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.className = 'toolbar-btn' + (extraClass ? ' ' + extraClass : '');
	btn.textContent = text;
	btn.onclick = onClick;
	return btn;
}

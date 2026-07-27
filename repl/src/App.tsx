import { onMount } from 'dartsx';
import { initEditors, setSourceContent, setOutputContent, getSourceContent, sourceEditor, outputEditor } from './editor/setup';
import { setupSourceMapLinking, setSourceMap } from './editor/source-map-linking';
import { compileSource } from './compiler/client';
import { renderToolbar } from './components/Toolbar';
import { renderErrorPanel } from './components/ErrorPanel';
import { mountPreview, sendToPreview } from './components/Preview';
import { DEFAULT_FILES } from './utils/default-files';
import { getShareUrl, loadFromHash } from './utils/share';
import { setFile, setActiveFile, setCompileResult, setCompiling } from './state/store';

export default component App() {
	let loadedFiles: Record<string, string> = { ...DEFAULT_FILES };
	let loadedActiveFile = 'main.tsx';
	let currentError: string | null = null;
	let compileTimer: number | null = null;

	onMount(() => {
		setup();
	});

	function setup() {
		const hashFiles = loadFromHash();
		if (hashFiles && Object.keys(hashFiles).length > 0) {
			loadedFiles = hashFiles;
			if (!loadedFiles['main.tsx']) loadedActiveFile = Object.keys(loadedFiles)[0];
		}

		for (const [name, source] of Object.entries(loadedFiles)) setFile(name, source);
		setActiveFile(loadedActiveFile);

		const root = document.getElementById('root')!;
		root.innerHTML = '';

		const layout = document.createElement('div');
		layout.className = 'repl-layout';
		root.appendChild(layout);

		const topBar = document.createElement('div');
		topBar.className = 'repl-top-bar';
		layout.appendChild(topBar);

		renderTopBar(topBar);

		const body = document.createElement('div');
		body.className = 'repl-body';
		layout.appendChild(body);

		const editorPane = document.createElement('div');
		editorPane.className = 'repl-editor-pane';
		body.appendChild(editorPane);

		const resizer = document.createElement('div');
		resizer.className = 'repl-resizer';
		body.appendChild(resizer);

		const rightPane = document.createElement('div');
		rightPane.className = 'repl-right-pane';
		body.appendChild(rightPane);

		const outputPane = document.createElement('div');
		outputPane.className = 'repl-output-pane';
		rightPane.appendChild(outputPane);

		const previewPane = document.createElement('div');
		previewPane.className = 'repl-preview-pane';
		rightPane.appendChild(previewPane);

		const errorContainer = document.createElement('div');
		errorContainer.className = 'repl-error-container';
		layout.appendChild(errorContainer);

		mountPreview(previewPane);
		initEditors(editorPane, outputPane);
		setupSourceMapLinking(sourceEditor, outputEditor);

		setSourceContent(loadedFiles[loadedActiveFile] || '');

		sourceEditor.onDidChangeModelContent(() => {
			if (compileTimer) clearTimeout(compileTimer);
			compileTimer = setTimeout(() => doCompile(), 500);
		});

		doCompile();

		setupResizer(resizer, editorPane, rightPane);
	}

	function renderTopBar(container: HTMLElement) {
		const tabsContainer = document.createElement('div');
		tabsContainer.className = 'repl-tabs';
		container.appendChild(tabsContainer);
		updateTabs(tabsContainer);

		const toolbar = renderToolbar({
			onRun: () => doCompile(),
			onShare: () => doShare(),
			onReset: () => doReset(),
			onFormat: () => {},
			isCompiling: false,
			hasError: !!currentError,
		});
		tabsContainer.appendChild(toolbar);
	}

	function updateTabs(container?: HTMLElement) {
		const target = container || document.querySelector('.repl-tabs');
		if (!target) return;
		const existing = target.querySelector('.file-tabs');
		if (existing) existing.remove();

		const names = Object.keys(loadedFiles);
		const tabsDiv = document.createElement('div');
		tabsDiv.className = 'file-tabs';

		for (const name of names) {
			const tab = document.createElement('button');
			tab.className = 'file-tab' + (name === loadedActiveFile ? ' active' : '');
			tab.textContent = name;

			if (names.length > 1) {
				const close = document.createElement('span');
				close.className = 'file-close';
				close.textContent = '×';
				close.onclick = (e) => {
					e.stopPropagation();
					delete loadedFiles[name];
					if (loadedActiveFile === name) {
						const remaining = Object.keys(loadedFiles);
						loadedActiveFile = remaining[0] || 'main.tsx';
						setActiveFile(loadedActiveFile);
						setSourceContent(loadedFiles[loadedActiveFile] || '');
					}
					target.insertBefore(tabsDiv, target.firstChild);
					updateTabs(target);
				};
				tab.appendChild(close);
			}

			tab.onclick = () => switchFile(name, target);
			tabsDiv.appendChild(tab);
		}

		const addBtn = document.createElement('button');
		addBtn.className = 'file-tab add-tab';
		addBtn.textContent = '+';
		addBtn.onclick = () => {
			const name = prompt('File name (e.g. Component.tsx):');
			if (name && !loadedFiles[name]) {
				loadedFiles[name] = '';
				setFile(name, '');
				loadedActiveFile = name;
				setActiveFile(name);
				setSourceContent('');
				target.insertBefore(tabsDiv, target.firstChild);
				updateTabs(target);
			}
		};
		tabsDiv.appendChild(addBtn);

		target.insertBefore(tabsDiv, target.firstChild);
	}

	function saveCurrentSource() {
		const content = getSourceContent();
		if (loadedActiveFile && loadedActiveFile in loadedFiles) {
			loadedFiles[loadedActiveFile] = content;
			setFile(loadedActiveFile, content);
		}
	}

	function switchFile(name: string, target?: HTMLElement) {
		saveCurrentSource();
		loadedActiveFile = name;
		setActiveFile(name);
		setSourceContent(loadedFiles[name] || '');
		const tabsContainer = target || document.querySelector('.repl-tabs');
		if (tabsContainer) updateTabs(tabsContainer as HTMLElement);
	}

	function doShare() {
		saveCurrentSource();
		const url = getShareUrl(loadedFiles);
		navigator.clipboard.writeText(url).then(() => {
			const shareBtn = document.querySelector('.toolbar-btn:nth-child(2)');
			if (shareBtn) {
				const orig = shareBtn.textContent;
				shareBtn.textContent = 'Copied!';
				setTimeout(() => { shareBtn.textContent = orig; }, 2000);
			}
		});
	}

	function doReset() {
		loadedFiles = { ...DEFAULT_FILES };
		loadedActiveFile = 'main.tsx';
		for (const [name, source] of Object.entries(loadedFiles)) setFile(name, source);
		setActiveFile(loadedActiveFile);
		setSourceContent(loadedFiles['main.tsx'] || '');
		const tabsContainer = document.querySelector('.repl-tabs');
		if (tabsContainer) updateTabs(tabsContainer as HTMLElement);
		doCompile();
	}

	async function doCompile() {
		saveCurrentSource();
		setCompiling(true);

		const source = loadedFiles[loadedActiveFile] || '';
		const filename = loadedActiveFile || 'main.tsx';

		try {
			const result = await compileSource(source, filename, loadedFiles);
			setCompileResult(result);

			if (result.error) {
				currentError = result.error;
				setOutputContent('', '');
				sendToPreview('', '');
			} else {
				currentError = null;
				setOutputContent(result.code, result.css);
				setSourceMap(result.map);
				sendToPreview(result.code, result.css);
			}
		} catch (e: any) {
			currentError = e.message;
			setCompileResult({ code: '', css: '', map: null, error: e.message });
			setOutputContent('', '');
			sendToPreview('', '');
		}

		setCompiling(false);
		updateErrorDisplay();
	}

	function updateErrorDisplay() {
		const container = document.querySelector('.repl-error-container');
		if (!container) return;
		container.innerHTML = '';
		const panel = renderErrorPanel(currentError);
		if (panel) container.appendChild(panel);
	}

	function setupResizer(handle: HTMLElement, left: HTMLElement, right: HTMLElement) {
		let isDragging = false;
		handle.addEventListener('mousedown', () => {
			isDragging = true;
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
		});
		document.addEventListener('mousemove', (e) => {
			if (!isDragging) return;
			const parent = left.parentElement!;
			const rect = parent.getBoundingClientRect();
			const pct = ((e.clientX - rect.left) / rect.width) * 100;
			const clamped = Math.max(30, Math.min(70, pct));
			left.style.width = clamped + '%';
			right.style.width = (100 - clamped) + '%';
		});
		document.addEventListener('mouseup', () => {
			isDragging = false;
			document.body.style.cursor = '';
			document.body.style.userSelect = '';
		});
	}
}

import { onMount } from 'dartsx';
import { compile, type FileOutput } from './compiler/client';
import { mountEditors, openFile, setOutput } from './editor/editors';
import { setEditorTheme } from './editor/highlight';
import { languageUris, syncFiles, TSCONFIG_FILE } from './editor/models';
import { mountLanguage, reloadLanguage } from './language/index';
import { DEFAULT_EXAMPLE_PATH, EXAMPLES, loadExample } from './state/examples';

const COMPILE_DEBOUNCE_MS = 250;

export default component App() {
	state activeTab = 'preview'
	state examplePath = DEFAULT_EXAMPLE_PATH
	state files = loadExample(DEFAULT_EXAMPLE_PATH)
	state activeFile = files[0].name
	state dark = true

	let tsconfigTimer: ReturnType<typeof setTimeout> | undefined
	let compileTimer: ReturnType<typeof setTimeout> | undefined
	let compileResult: Record<string, FileOutput> | null = null

	function showOutput() {
		const result = compileResult?.[activeFile]
		if (!result) {
			setOutput(`// compiling ${activeFile}…`)
		} else if (result.error) {
			setOutput(`// compile error in ${activeFile}\n\n${result.error}`)
		} else if (result.code !== null) {
			setOutput(result.code)
		} else {
			setOutput(`// ${activeFile} produces no compiled output`)
		}
	}

	function runCompile() {
		void compile(files).then((outputs) => {
			if (!outputs) return
			compileResult = outputs
			showOutput()
		})
	}

	function scheduleCompile() {
		clearTimeout(compileTimer)
		compileTimer = setTimeout(runCompile, COMPILE_DEBOUNCE_MS)
	}

	function selectExample(path: string) {
		examplePath = path
		files = loadExample(path)
		activeFile = files[0].name
		syncFiles(files)
		openFile(activeFile)
		compileResult = null
		runCompile()
	}

	function selectFile(name: string) {
		activeFile = name
		openFile(name)
		showOutput()
	}

	function toggleTheme() {
		dark = !dark
		setEditorTheme(dark)
	}

	function onSourceChange(name: string, source: string) {
		const file = files.find((candidate) => candidate.name === name)
		if (file && file.source !== source) file.source = source
		if (name === TSCONFIG_FILE) {
			clearTimeout(tsconfigTimer)
			tsconfigTimer = setTimeout(() => reloadLanguage(), 500)
		} else {
			scheduleCompile()
		}
	}

	function getCompilerOptions(): Record<string, unknown> | null {
		try {
			const parsed = JSON.parse(files.find((file) => file.name === TSCONFIG_FILE)?.source ?? '')
			return (parsed?.compilerOptions as Record<string, unknown>) ?? null
		} catch {
			return null
		}
	}

	onMount(() => {
		mountEditors(
			document.getElementById('editor-mount')!,
			document.getElementById('output-mount')!,
			{ onSourceChange, onOpenFile: selectFile },
		)
		syncFiles(files)
		openFile(activeFile)
		showOutput()
		mountLanguage({ getSyncUris: () => languageUris(), getCompilerOptions })
		runCompile()
	})

	render (
		<div class="layout">
			<div class="side">
				<div class="bar">
					{for (const example of EXAMPLES) (
						<button
							class={example.path === examplePath ? 'active' : ''}
							onclick={() => selectExample(example.path)}
						>
							{example.label}
						</button>
					)}
					<span class="gap" />
					{for (const file of files) (
						<button
							class={file.name === activeFile ? 'active' : ''}
							onclick={() => selectFile(file.name)}
						>
							{file.name}
						</button>
					)}
					<span class="gap" />
					<button onclick={() => toggleTheme()}>Theme</button>
				</div>
				<div id="editor-mount" class="editor" />
			</div>
			<div class="side">
				<div class="bar">
					<button class={activeTab === 'preview' ? 'active' : ''} onclick={() => (activeTab = 'preview')}>Preview</button>
					<button class={activeTab === 'output' ? 'active' : ''} onclick={() => (activeTab = 'output')}>Output</button>
				</div>
				<div id="preview-mount" class={activeTab === 'preview' ? 'fill' : 'fill hidden'}>preview</div>
				<div id="output-mount" class={activeTab === 'output' ? 'fill' : 'fill hidden'} />
			</div>
		</div>
		<style>
			.layout { display: flex; height: 100vh; }
			.side { flex: 1; min-width: 0; display: flex; flex-direction: column; }
			.bar { display: flex; align-items: center; gap: 4px; padding: 4px; border-bottom: 1px solid #ccc; }
			.gap { flex: 1; }
			.editor { flex: 1; min-height: 0; }
			.fill { flex: 1; min-height: 0; }
			.hidden { display: none; }
			.active { font-weight: bold; }
		</style>
	)
}

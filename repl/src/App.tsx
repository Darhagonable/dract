// The playground: write TSX on the left, and on the right either the LIVE
// rendered app or the compiled output, switchable with the toolbar switch.
// The compiled pane selects a Client, Server, or Types artifact — Server and
// Types are placeholders kept for future emits — shown as code or an AST
// (the AST view is a placeholder in this build).
//
// This component is the composition root: it owns the engine wiring
// (Monaco editors, the compiler worker, the language worker, and the preview
// sandbox) and composes the presentational components over it:
// PlaygroundToolbar (examples + view switch), EditorPane (file tabs + the
// source editor host), ResultPane (preview or compiled output hosts), and
// the mobile bottom toggle. Editors, panels, and the preview all follow the
// site's light/dark theme (the data-theme contract from index.html). A
// workspace is a set of virtual files with an entry (the first file); the
// Examples dropdown loads curated workspaces from repl/examples/, the file
// tabs manage the file set (add/delete/rename/reorder), and editing any file
// flips the dropdown to "Custom".
import { onMount, onCleanup, effect } from 'dartsx';
import { compile, type FileOutput } from './compiler/client';
import { mountEditors, openFile, setOutput } from './editor/editors';
import { setEditorTheme } from './editor/highlight';
import { languageUris, syncFiles, TSCONFIG_FILE, type PlaygroundFile } from './editor/models';
import { mountLanguage, reloadLanguage } from './language/index';
import { mountPreview, type Preview } from './preview/sandbox';
import { DEFAULT_EXAMPLE_PATH, EXAMPLE_GROUPS, loadExample } from './state/examples';
import { PlaygroundToolbar } from './components/PlaygroundToolbar';
import { EditorPane } from './components/EditorPane';
import { ResultPane, type OutputTarget } from './components/ResultPane';
import { MobileToggle } from './components/MobileToggle';
import './components/playground.css';

const COMPILE_DEBOUNCE_MS = 250;
const MAX_PLAYGROUND_FILES = 10;
const CUSTOM_EXAMPLE = 'custom';

const NEW_FILE_TEMPLATE = `export default component Untitled() {
	render (
		<p>Edit me</p>
	)
}
`;

export default component App() {
	state view = 'preview' as 'preview' | 'compiled'
	state pane = 'editor' as 'editor' | 'result'
	state examplePath = DEFAULT_EXAMPLE_PATH
	state files = loadExample(DEFAULT_EXAMPLE_PATH)
	state activeFile = files[0].name
	state ready = false
	state error = ''
	state outputTarget = 'client' as OutputTarget
	state compiledMode = 'code' as 'code' | 'ast'
	// Reserved for shared-link payloads: nothing gates the default
	// workspaces in this build (there is no hash persistence yet).
	state gated = false

	let tsconfigTimer: ReturnType<typeof setTimeout> | undefined
	let compileTimer: ReturnType<typeof setTimeout> | undefined
	let compileResult: Record<string, FileOutput> | null = null
	let preview: Preview | null = null

	let sourceHost: HTMLDivElement | undefined
	let outputHost: HTMLDivElement | undefined
	let previewHost: HTMLDivElement | undefined
	let devtoolsHost: HTMLDivElement | undefined

	derived entryFile = files[0].name
	derived fileNames = files.map((file) => file.name)

	function showError(message: string) {
		error = message
	}

	function showOutput() {
		if (outputTarget !== 'client') {
			setOutput(
				outputTarget === 'server'
					? '// Server rendering is not available yet.'
					: '// Type declarations are not generated yet.',
			)
			return
		}
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

	// Switching artifacts re-renders the output pane.
	effect(outputTarget, () => {
		showOutput()
	})

	function runCompile() {
		compile(files).then(
			(result) => {
				if (!result) return
				compileResult = result.outputs
				error = ''
				showOutput()
				if (result.graphError) {
					preview?.reportError(`Graph error\n\n${result.graphError}`)
					return
				}
				if (result.graph) {
					void preview?.run(result.graph).then((run) => {
						if (run?.error) showError(run.error)
					})
				}
			},
			(compileError) => {
				// A failed worker boot must be visible, not a silent hang.
				const message = compileError instanceof Error ? compileError.message : String(compileError)
				showError(`Compiler unavailable\n\n${message}`)
			},
		)
	}

	function scheduleCompile() {
		clearTimeout(compileTimer)
		compileTimer = setTimeout(runCompile, COMPILE_DEBOUNCE_MS)
	}

	function markCustom() {
		examplePath = CUSTOM_EXAMPLE
	}

	function selectExample(path: string) {
		examplePath = path
		files = loadExample(path)
		activeFile = files[0].name
		syncFiles(files)
		openFile(activeFile)
		compileResult = null
		error = ''
		runCompile()
	}

	function selectFile(name: string) {
		activeFile = name
		openFile(name)
		showOutput()
	}

	function nextFileName(): string {
		for (let index = 1; ; index++) {
			const name = `untitled-${index}.tsx`
			if (!files.some((file) => file.name === name)) return name
		}
	}

	function addFile() {
		if (files.length >= MAX_PLAYGROUND_FILES) return
		const file: PlaygroundFile = { name: nextFileName(), source: NEW_FILE_TEMPLATE }
		const tsconfigIndex = files.findIndex((candidate) => candidate.name === TSCONFIG_FILE)
		const at = tsconfigIndex === -1 ? files.length : tsconfigIndex
		files.splice(at, 0, file)
		markCustom()
		syncFiles(files)
		activeFile = file.name
		openFile(file.name)
		scheduleCompile()
	}

	function renameFile(name: string, next: string) {
		if (name === next || files.some((file) => file.name === next)) return
		const file = files.find((candidate) => candidate.name === name)
		if (!file) return
		file.name = next
		markCustom()
		syncFiles(files)
		activeFile = next
		openFile(next)
		scheduleCompile()
	}

	function removeFile(name: string) {
		if (name === entryFile || name === TSCONFIG_FILE) return
		const index = files.findIndex((file) => file.name === name)
		if (index === -1) return
		files.splice(index, 1)
		markCustom()
		syncFiles(files)
		if (activeFile === name) {
			activeFile = files[0].name
			openFile(activeFile)
		}
		scheduleCompile()
	}

	function moveFile(from: string, to: string) {
		if (from === to || from === TSCONFIG_FILE || to === TSCONFIG_FILE) return
		const fromIndex = files.findIndex((file) => file.name === from)
		const toIndex = files.findIndex((file) => file.name === to)
		if (fromIndex === -1 || toIndex === -1) return
		const [moved] = files.splice(fromIndex, 1)
		files.splice(toIndex, 0, moved)
		markCustom()
		// The model set is unchanged, but the entry (files[0]) may have
		// moved — the graph follows it.
		scheduleCompile()
	}

	function onSourceChange(name: string, source: string) {
		const file = files.find((candidate) => candidate.name === name)
		if (file && file.source !== source) file.source = source
		markCustom()
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

	function selectView(next: 'preview' | 'compiled') {
		view = next
	}

	function openMobilePreview() {
		view = 'preview'
		pane = 'result'
	}

	function openMobileCompiled() {
		view = 'compiled'
		pane = 'result'
		showOutput()
	}

	function openMobileEditor() {
		pane = 'editor'
	}

	function selectOutputTarget(next: OutputTarget) {
		outputTarget = next
	}

	function selectCompiledMode(next: 'code' | 'ast') {
		compiledMode = next
	}

	function approveRun() {
		gated = false
	}

	onMount(() => {
		mountEditors(
			sourceHost!,
			outputHost!,
			{ onSourceChange, onOpenFile: selectFile },
		)
		syncFiles(files)
		openFile(activeFile)
		showOutput()
		mountLanguage({ getSyncUris: languageUris, getCompilerOptions })
		preview = mountPreview(previewHost!, {
			onRuntimeError: (message) => showError(`Runtime error\n\n${message}`),
		})
		// The chrome follows <html data-theme> (set pre-paint by the init
		// script in index.html and toggled by the fixed button from
		// main.ts); relay flips to the Monaco themes.
		const applyTheme = () => setEditorTheme(document.documentElement.getAttribute('data-theme') !== 'light')
		applyTheme()
		const themeObserver = new MutationObserver(applyTheme)
		themeObserver.observe(document.documentElement, { attributeFilter: ['data-theme'] })
		onCleanup(() => themeObserver.disconnect())
		runCompile()
		ready = true
	})

	render (
		<div class="pg">
			<PlaygroundToolbar
				ready={ready}
				examplePath={examplePath}
				view={view}
				groups={EXAMPLE_GROUPS}
				onSelectExample={selectExample}
				onSelectView={selectView}
			/>
			{if (error) (
				<div class="pg-error" role="alert">{error}</div>
			)}
			<div class={ready ? 'pg-grid ready' : 'pg-grid'}>
				<EditorPane
					pane={pane}
					ready={ready}
					files={fileNames}
					activeFile={activeFile}
					entryFile={entryFile}
					onAdd={addFile}
					onSelect={selectFile}
					onRename={renameFile}
					onRemove={removeFile}
					onMove={moveFile}
				>
					<div class="pg-editor" bind:this={sourceHost} />
				</EditorPane>
				<ResultPane
					pane={pane}
					view={view}
					compiledMode={compiledMode}
					outputTarget={outputTarget}
					gated={gated}
					ready={ready}
					activeFile={activeFile}
					devtoolsOpen={false}
					preview={<div class="pg-preview" bind:this={previewHost} />}
					devtools={<div class="pg-devtools-host" bind:this={devtoolsHost} />}
					ast={
						<div class="pg-ast-shell">
							<div class="pg-ast-status">{entryFile}</div>
							<div class="pg-ast-scroll">The AST inspector is not available in this build yet.</div>
							<div class="pg-ast-notice">Compiler AST; its internal shape may change.</div>
						</div>
					}
					output={<div class="pg-editor" bind:this={outputHost} />}
					onSelectCompiledMode={selectCompiledMode}
					onSelectOutputTarget={selectOutputTarget}
					onApproveRun={approveRun}
				/>
			</div>
			<MobileToggle
				pane={pane}
				view={view}
				onEditor={openMobileEditor}
				onPreview={openMobilePreview}
				onCompiled={openMobileCompiled}
			/>
		</div>
	)
}

// /playground — write TSX on the left, and on the right either the
// LIVE rendered app or the compiled output, switchable with a tab. The
// compiled pane selects a Client, Server, or Types artifact and shows it as
// code or an AST. Server and Types are kept as targets for future DarTsx
// emits (a server renderer, .d.ts output) and show a placeholder until then.
// Hovering or selecting source reveals the corresponding AST node where the
// parser has a span; hovering a tree node highlights its origin document. In
// code form the Client target maps BOTH ways — through the compile's source
// map, widened with verified text matches (see playground-mapping.ts).
//
// All engine state and the editor stack live in use-playground.ts (a hook);
// this page composes presentational components over it:
// PlaygroundToolbar (examples + format + view switch), EditorPane (file tabs
// + source editor host), ResultPane (preview or compiled output hosts), and
// the mobile bottom toggle. Editors, panels, and the preview canvas all
// follow the site's light/dark theme. A workspace is a set of virtual files
// with an entry. The Examples dropdown loads curated workspaces from
// repl/examples/ (src/utils/playground-examples.ts); the file tabs manage the
// file set (add/delete), and editing any file flips it to "Custom". The
// active workspace persists into `location.hash` (debounced) so playground
// states are shareable links, and the Format button runs client-side
// Prettier (src/utils/playground-format.ts).
import { useTitle } from './utils/use-title.ts';
import { cx } from './utils/cx.ts';
import { EditorPane } from './components/EditorPane.tsx';
import { MobileToggle } from './components/MobileToggle.tsx';
import { PlaygroundToolbar } from './components/PlaygroundToolbar.tsx';
import { ResultPane } from './components/ResultPane.tsx';
import { usePlayground } from './utils/use-playground.ts';
import './components/playground.css';

export function Playground() {
	useTitle('Octane — Playground');
	const engine = usePlayground();
	const {
		view,
		pane,
		paneRef,
		error,
		ready,
		formatting,
		gated,
		exampleId,
		files,
		activeFile,
		inputValue,
		renameInputRef,
		dragOverFile,
		draggingFileRef,
		entryFile,
		compiledMode,
		outputTarget,
		devtoolsOpen,
		sourceHostRef,
		outputHostRef,
		astHostRef,
		previewHostRef,
		devtoolsHostRef,
		controller,
		selectView,
		openMobilePreview,
		openMobileCompiled,
		selectCompiledMode,
		selectOutputTarget,
		setPane,
		setInputValue,
		setDragOverFile,
		toggleDevtools,
	} = engine;

	return (
		<div className="pg">
			<PlaygroundToolbar
				ready={ready}
				formatting={formatting}
				exampleId={exampleId}
				view={view}
				controller={controller}
				onSelectView={selectView}
			/>

			{error && (
				<div className="pg-error" role="alert">
					{error}
				</div>
			)}

			<div className={cx('pg-grid', ready && 'ready')}>
				<EditorPane
					pane={pane}
					ready={ready}
					files={files}
					activeFile={activeFile}
					entryFile={entryFile}
					inputValue={inputValue}
					dragOverFile={dragOverFile}
					renameInputRef={renameInputRef}
					draggingFileRef={draggingFileRef}
					sourceHostRef={sourceHostRef}
					controller={controller}
					onSetInputValue={setInputValue}
					onSetDragOverFile={setDragOverFile}
				/>
				<ResultPane
					pane={pane}
					view={view}
					compiledMode={compiledMode}
					outputTarget={outputTarget}
					gated={gated}
					ready={ready}
					activeFile={activeFile}
					previewHostRef={previewHostRef}
					devtoolsHostRef={devtoolsHostRef}
					astHostRef={astHostRef}
					outputHostRef={outputHostRef}
					devtoolsOpen={devtoolsOpen}
					controller={controller}
					onSelectCompiledMode={selectCompiledMode}
					onSelectOutputTarget={selectOutputTarget}
					onToggleDevtools={toggleDevtools}
				/>
			</div>

			<MobileToggle
				pane={pane}
				view={view}
				onEditor={() => {
					paneRef.current = 'editor';
					setPane('editor');
				}}
				onPreview={openMobilePreview}
				onCompiled={openMobileCompiled}
			/>
		</div>
	);
}
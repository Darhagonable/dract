// The left panel: the file tab strip (with its add button and loading hint)
// above the Monaco source editor. The editor itself is mounted into the host
// div (passed as the children slot) by App's onMount.
import { FileTabs } from './FileTabs';

export component EditorPane(
	pane: 'editor' | 'result',
	ready: boolean,
	files: string[],
	activeFile: string,
	entryFile: string,
	onAdd: () => void,
	onSelect: (name: string) => void,
	onRename: (name: string, next: string) => void,
	onRemove: (name: string) => void,
	onMove: (from: string, to: string) => void,
	children: any,
) {
	render (
		<section class={['pg-panel', pane !== 'editor' && 'mobile-hidden']} aria-label="Source editor">
			<div class="pg-panel-head">
				<FileTabs
					files={files}
					activeFile={activeFile}
					entryFile={entryFile}
					ready={ready}
					onAdd={onAdd}
					onSelect={onSelect}
					onRename={onRename}
					onRemove={onRemove}
					onMove={onMove}
				/>
				{if (!ready) (<span class="pg-loading">Loading editor…</span>)}
			</div>
			{children}
		</section>
	)
}

// The left panel: the file tab strip (with its add button and loading hint)
// above the embedded VS Code workbench hosting the source editor. The
// workbench is mounted into the host div by the engine's boot effect (see
// use-playground.ts).
import type { MutableRefObject, RefObject } from 'react';
import { cx } from '../utils/cx.ts';
import { FileTabs } from './FileTabs.tsx';
import type { PlaygroundController } from '../utils/use-playground.ts';

interface EditorPaneProps {
	pane: 'editor' | 'result';
	ready: boolean;
	files: string[];
	activeFile: string;
	entryFile: string;
	inputValue: string;
	dragOverFile: string | null;
	renameInputRef: RefObject<HTMLInputElement | null>;
	draggingFileRef: MutableRefObject<string | null>;
	sourceHostRef: RefObject<HTMLDivElement | null>;
	controller: PlaygroundController;
	onSetInputValue: (value: string) => void;
	onSetDragOverFile: (file: string | null) => void;
}

export function EditorPane({
	pane,
	ready,
	files,
	activeFile,
	entryFile,
	inputValue,
	dragOverFile,
	renameInputRef,
	draggingFileRef,
	sourceHostRef,
	controller,
	onSetInputValue,
	onSetDragOverFile,
}: EditorPaneProps) {
	return (
		<section className={cx('pg-panel', pane !== 'editor' && 'mobile-hidden')} aria-label="Source editor">
			<div className="pg-panel-head">
				<FileTabs
					files={files}
					activeFile={activeFile}
					entryFile={entryFile}
					inputValue={inputValue}
					dragOverFile={dragOverFile}
					ready={ready}
					renameInputRef={renameInputRef}
					draggingFileRef={draggingFileRef}
					controller={controller}
					onSetInputValue={onSetInputValue}
					onSetDragOverFile={onSetDragOverFile}
				/>
				{!ready && <span className="pg-loading">Loading editor…</span>}
			</div>
			<div className="pg-editor" ref={sourceHostRef} />
		</section>
	);
}
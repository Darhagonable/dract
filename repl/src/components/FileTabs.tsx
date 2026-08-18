// The source panel's file tab strip: Svelte-REPL-style tabs — the active
// tab's name is a live inline input (rename in place), tabs drag to reorder,
// and the trailing + button adds files. The workspace config file
// (tsconfig.json) is pinned to the FAR RIGHT of the strip, separated from the
// editable tabs like the Vue REPL's tsconfig tab: not renamable, not
// removable, not draggable. Presentational: file operations route through the
// engine's controller (see use-playground.ts).
import type { MutableRefObject, RefObject } from 'react';
import { cx } from '../utils/cx.ts';
import { MAX_PLAYGROUND_FILES } from '../utils/playground-hash.ts';
import { TSCONFIG_FILE_NAME, isTsconfigFile } from '../utils/playground-modules.ts';
import type { PlaygroundController } from '../utils/use-playground.ts';

interface FileTabsProps {
	files: string[];
	activeFile: string;
	entryFile: string;
	inputValue: string;
	dragOverFile: string | null;
	ready: boolean;
	renameInputRef: RefObject<HTMLInputElement | null>;
	draggingFileRef: MutableRefObject<string | null>;
	controller: PlaygroundController;
	onSetInputValue: (value: string) => void;
	onSetDragOverFile: (file: string | null) => void;
}

export function FileTabs({
	files,
	activeFile,
	entryFile,
	inputValue,
	dragOverFile,
	ready,
	renameInputRef,
	draggingFileRef,
	controller,
	onSetInputValue,
	onSetDragOverFile,
}: FileTabsProps) {
	// The config file leaves the tab strip entirely: it renders as a sibling
	// of .pg-tabs, so the panel head's space-between layout pins it right.
	const sourceFiles = files.filter((name) => !isTsconfigFile(name));
	const configFile = files.find(isTsconfigFile) ?? null;
	return (
		<>
			<div className="pg-tabs" role="tablist" aria-label="Playground files">
				{sourceFiles.map((name) => (
				<div
					key={name}
					className={cx('pg-tab', name === activeFile && 'active', dragOverFile === name && 'drag-over')}
					role="tab"
					tabIndex={0}
					aria-selected={name === activeFile}
					draggable={true}
					onClick={() => controller.selectFile?.(name)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							controller.selectFile?.(name);
						}
					}}
					onDragStart={(e) => {
						draggingFileRef.current = name;
						e.dataTransfer!.effectAllowed = 'move';
						e.dataTransfer!.setData('text/plain', name);
					}}
					onDragOver={(e) => {
						e.preventDefault();
						onSetDragOverFile(name);
					}}
					onDragLeave={() => {
						if (dragOverFile === name) onSetDragOverFile(null);
					}}
					onDrop={(e) => {
						e.preventDefault();
						const from = draggingFileRef.current;
						draggingFileRef.current = null;
						onSetDragOverFile(null);
						if (from && from !== name) {
							controller.moveFile?.(from, name);
						}
					}}
					onDragEnd={() => {
						draggingFileRef.current = null;
						onSetDragOverFile(null);
					}}
				>
					{name === entryFile && (
						<span
							className="pg-tab-dot"
							title="Entry file — the preview renders this module's default export"
						/>
					)}
					<span className="pg-tab-name">
						<span
							className={name === activeFile && name !== entryFile ? 'pg-tab-input-mask' : undefined}
						>
							{name === activeFile && name !== entryFile ? inputValue : name}
						</span>
						{name === activeFile && name !== entryFile && (
							<input
								ref={renameInputRef}
								className="pg-tab-input"
								value={inputValue}
								spellCheck={false}
								aria-label={'Rename ' + name}
								onInput={(e) => onSetInputValue(e.currentTarget.value)}
								onFocus={(e) => {
									const input = e.currentTarget;
									setTimeout(() => input.select());
								}}
								onBlur={() => {
									if (inputValue === name || inputValue === '') {
										onSetInputValue(name);
										return;
									}
									controller.renameFile?.(name, inputValue);
								}}
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										e.currentTarget.blur();
									} else if (e.key === 'Escape') {
										onSetInputValue(name);
										e.currentTarget.blur();
									}
								}}
							/>
						)}
					</span>
					{name === activeFile && name !== entryFile && (
						<button
							type="button"
							className="pg-tab-close"
							aria-label={'Delete ' + name}
							title="Delete file"
							disabled={sourceFiles.length <= 1}
							onClick={(e) => {
								e.stopPropagation();
								if (window.confirm('Delete ' + name + '?')) {
									controller.removeFile?.(name);
								}
							}}
						>
							{'×'}
						</button>
					)}
				</div>
			))}
			<button
				type="button"
				className="pg-tab-add"
				aria-label="Add file"
				title={'Add a file (up to ' + MAX_PLAYGROUND_FILES + ')'}
				disabled={!ready || files.length >= MAX_PLAYGROUND_FILES}
				onClick={() => controller.addFile?.()}
			>
				{'+'}
			</button>
			</div>
			{configFile && (
				<div
					className={cx('pg-tab', 'pg-tab-config', configFile === activeFile && 'active')}
					role="tab"
					tabIndex={0}
					aria-selected={configFile === activeFile}
					title="Playground TypeScript configuration — read-only name, editable contents"
					onClick={() => controller.selectFile?.(configFile)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							controller.selectFile?.(configFile);
						}
					}}
				>
					<span className="pg-tab-name">{TSCONFIG_FILE_NAME}</span>
				</div>
			)}
		</>
	);
}
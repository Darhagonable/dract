// The source panel's file tab strip: Svelte-REPL-style tabs — the active
// tab's name is a live inline input (rename in place), tabs drag to reorder,
// and the trailing + button adds files. The workspace config file
// (tsconfig.json) is pinned to the FAR RIGHT of the strip, separated from the
// editable tabs like the Vue REPL's tsconfig tab: not renamable, not
// removable, not draggable. Presentational: file operations route through
// App's handlers.
import { effect } from 'dartsx';
import { TSCONFIG_FILE } from '../constants';

export const MAX_PLAYGROUND_FILES = 10;

export component FileTabs(
	files: string[],
	activeFile: string,
	entryFile: string,
	ready: boolean,
	onAdd: () => void,
	onSelect: (name: string) => void,
	onRename: (name: string, next: string) => void,
	onRemove: (name: string) => void,
	onMove: (from: string, to: string) => void,
) {
	// Drag state: the hovered tab renders (state) while the dragged name is
	// only needed between dragstart and drop (plain let).
	state dragOverFile = ''
	let draggingFile: string | null = null
	let renameInput: HTMLInputElement | undefined

	// The rename draft always starts as the active tab's name.
	state draft = activeFile
	effect(activeFile, (name) => {
		draft = name
	})

	// The config file leaves the tab strip entirely: it renders as a sibling
	// of .pg-tabs, so the panel head's space-between layout pins it right.
	derived sourceFiles = files.filter((name) => name !== TSCONFIG_FILE)
	derived configFile = files.find((name) => name === TSCONFIG_FILE) ?? ''

	function onTabKeydown(e: KeyboardEvent, name: string) {
		if (e.key === 'Enter' || e.key === ' ') onSelect(name)
	}

	function onDragStart(e: DragEvent, name: string) {
		draggingFile = name
		e.dataTransfer!.effectAllowed = 'move'
		e.dataTransfer!.setData('text/plain', name)
	}

	function onDragOver(e: DragEvent, name: string) {
		e.preventDefault()
		dragOverFile = name
	}

	function onDragLeave(name: string) {
		if (dragOverFile === name) dragOverFile = ''
	}

	function onDrop(e: DragEvent, name: string) {
		e.preventDefault()
		const from = draggingFile
		draggingFile = null
		dragOverFile = ''
		if (from && from !== name) onMove(from, name)
	}

	function onDragEnd() {
		draggingFile = null
		dragOverFile = ''
	}

	function onInput(e: Event) {
		draft = (e.target as HTMLInputElement).value
	}

	function onFocus() {
		const input = renameInput
		if (input) setTimeout(() => input.select())
	}

	// Commit on blur: empty, unchanged, or colliding drafts reset instead.
	function onBlur(name: string) {
		if (draft === name || draft === '' || files.includes(draft)) {
			draft = name
			return
		}
		onRename(name, draft)
	}

	function onKeydown(e: KeyboardEvent, name: string) {
		if (e.key === 'Enter') {
			e.preventDefault()
			renameInput?.blur()
		} else if (e.key === 'Escape') {
			draft = name
			renameInput?.blur()
		}
	}

	function onCloseClick(e: MouseEvent, name: string) {
		e.stopPropagation()
		if (window.confirm('Delete ' + name + '?')) onRemove(name)
	}

	function onAddClick() {
		onAdd()
	}

	render (
		<div class="pg-tabs" role="tablist" aria-label="Playground files">
			{for (const name of sourceFiles; key name) (
				<div
					class={['pg-tab', name === activeFile && 'active', dragOverFile === name && 'drag-over']}
					role="tab"
					tabindex="0"
					aria-selected={name === activeFile ? 'true' : 'false'}
					draggable="true"
					onclick={() => onSelect(name)}
					onkeydown={(e) => onTabKeydown(e, name)}
					ondragstart={(e) => onDragStart(e, name)}
					ondragover={(e) => onDragOver(e, name)}
					ondragleave={() => onDragLeave(name)}
					ondrop={(e) => onDrop(e, name)}
					ondragend={onDragEnd}
				>
					{if (name === entryFile) (
						<span
							class="pg-tab-dot"
							title="Entry file — the preview renders this module's default export"
						/>
					)}
					<span class="pg-tab-name">
						<span class={name === activeFile && name !== entryFile ? 'pg-tab-input-mask' : ''}>
							{name === activeFile && name !== entryFile ? draft : name}
						</span>
						{if (name === activeFile && name !== entryFile) (
							<input
								bind:this={renameInput}
								class="pg-tab-input"
								bind:value={draft}
								oninput={onInput}
								spellcheck="false"
								aria-label={'Rename ' + name}
								onfocus={onFocus}
								onblur={() => onBlur(name)}
								onkeydown={(e) => onKeydown(e, name)}
							/>
						)}
					</span>
					{if (name === activeFile && name !== entryFile) (
						<button
							type="button"
							class="pg-tab-close"
							aria-label={'Delete ' + name}
							title="Delete file"
							disabled={sourceFiles.length <= 1}
							onclick={(e) => onCloseClick(e, name)}
						>
							×
						</button>
					)}
				</div>
			)}
			<button
				type="button"
				class="pg-tab-add"
				aria-label="Add file"
				title={'Add a file (up to ' + MAX_PLAYGROUND_FILES + ')'}
				disabled={!ready || files.length >= MAX_PLAYGROUND_FILES}
				onclick={onAddClick}
			>
				+
			</button>
		</div>
		{if (configFile) (
			<div
				class={['pg-tab', 'pg-tab-config', configFile === activeFile && 'active']}
				role="tab"
				tabindex="0"
				aria-selected={configFile === activeFile ? 'true' : 'false'}
				title="Playground TypeScript configuration — read-only name, editable contents"
				onclick={() => onSelect(configFile)}
				onkeydown={(e) => onTabKeydown(e, configFile)}
			>
				<span class="pg-tab-name">{TSCONFIG_FILE}</span>
			</div>
		)}
	)
}

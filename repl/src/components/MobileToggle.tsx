// Mobile-only: the floating bottom toggle that picks which of the two panels
// is visible (desktop always shows both). Preview and Inspect are the two
// result views; Code returns to the editor.

export component MobileToggle(
	pane: 'editor' | 'result',
	view: 'preview' | 'compiled',
	onEditor: () => void,
	onPreview: () => void,
	onCompiled: () => void,
) {
	render (
		<div class="pg-mobile-toggle" role="group" aria-label="Visible panel">
			<button
				type="button"
				class={['pg-seg-btn', pane === 'editor' && 'active']}
				onclick={onEditor}
			>
				Code
			</button>
			<button
				type="button"
				class={['pg-seg-btn', pane === 'result' && view === 'preview' && 'active']}
				onclick={onPreview}
			>
				Preview
			</button>
			<button
				type="button"
				class={['pg-seg-btn', pane === 'result' && view === 'compiled' && 'active']}
				title="Show the compiled output for the current file"
				onclick={onCompiled}
			>
				Inspect
			</button>
		</div>
	)
}

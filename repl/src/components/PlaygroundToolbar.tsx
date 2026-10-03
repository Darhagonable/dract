// The page's toolbar: the Examples dropdown, the Format button, and the
// desktop Preview/Compiled view switch. All of it is presentational —
// actions route through App's handlers. The Format button is rendered as a
// stub: Prettier formatting is not wired into this build.
import { effect } from 'dartsx';
import type { ExampleGroup } from '../state/examples';

export component PlaygroundToolbar(
	ready: boolean,
	examplePath: string,
	view: 'preview' | 'compiled',
	groups: ExampleGroup[],
	onSelectExample: (path: string) => void,
	onSelectView: (next: 'preview' | 'compiled') => void,
) {
	// bind:value needs a local state target; the mirror tracks the
	// app-level selection (e.g. the flip to 'custom' after edits).
	state selection = examplePath
	effect(examplePath, (path) => {
		selection = path
	})

	function onChange(e: Event) {
		onSelectExample((e.target as HTMLSelectElement).value)
	}

	render (
		<div class="pg-toolbar">
			<div class="pg-toolbar-side">
				<select
					class="pg-select"
					aria-label="Example"
					disabled={!ready}
					bind:value={selection}
					onchange={onChange}
				>
					{/* Static placeholder shown only while the workspace has diverged from
					    every example — always in the DOM (no conditional rendering
					    inside the select) so the option list never reconciles. */}
					<option value="custom" disabled hidden>
						Custom
					</option>
					{for (const group of groups) (
						<optgroup label={group.label}>
							{for (const example of group.examples) (
								<option value={example.path}>{example.label}</option>
							)}
						</optgroup>
					)}
				</select>
				<button
					type="button"
					class="pg-format"
					disabled
					title="Format is not available in this build yet"
				>
					Format
				</button>
			</div>
			<div class="pg-seg pg-view-switch" role="group" aria-label="Result view">
				<button
					type="button"
					class={['pg-seg-btn', view === 'preview' && 'active']}
					onclick={() => onSelectView('preview')}
				>
					Preview
				</button>
				<button
					type="button"
					class={['pg-seg-btn', view === 'compiled' && 'active']}
					onclick={() => onSelectView('compiled')}
				>
					Compiled
				</button>
			</div>
		</div>
	)
}

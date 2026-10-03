// The right panel: a live-preview mode (sandboxed iframe + the shared-code
// consent gate) and a compiled mode (Client/Server/Types artifact as code or
// an AST tree). The Monaco output editor and the AST contents are provided by
// App as slot props; Server and Types artifacts are placeholders in this
// build, and the DevTools button is a disabled stub.
import { effect } from 'dartsx';
import { ConsentOverlay } from './ConsentOverlay';

export type OutputTarget = 'client' | 'server' | 'types'

export const OUTPUT_TARGET_LABEL: Record<OutputTarget, string> = {
	client: 'Client',
	server: 'Server',
	types: 'Types',
}

export component ResultPane(
	pane: 'editor' | 'result',
	view: 'preview' | 'compiled',
	compiledMode: 'code' | 'ast',
	outputTarget: OutputTarget,
	gated: boolean,
	ready: boolean,
	activeFile: string,
	devtoolsOpen: boolean,
	preview: any,
	devtools: any,
	ast: any,
	output: any,
	onSelectCompiledMode: (next: 'code' | 'ast') => void,
	onSelectOutputTarget: (next: OutputTarget) => void,
	onApproveRun: () => void,
) {
	// bind:value needs a local state target; the mirror tracks the
	// app-level selection.
	state target = outputTarget
	effect(outputTarget, (next) => {
		target = next
	})

	function onTargetChange(e: Event) {
		onSelectOutputTarget((e.target as HTMLSelectElement).value as OutputTarget)
	}

	render (
		<section class={['pg-panel', pane !== 'result' && 'mobile-hidden']} aria-label="Result">
			<div class="pg-panel-head">
				<span>
					{view === 'preview'
						? 'Live preview'
						: OUTPUT_TARGET_LABEL[outputTarget] +
							(compiledMode === 'ast' ? ' AST · ' : ' output · ') +
							(activeFile || '…')}
				</span>
				<div class="pg-compiled-controls">
					{if (view === 'preview') (
						<button
							type="button"
							class="pg-seg-btn"
							disabled
							title="DevTools are not available in this build yet"
						>
							DevTools
						</button>
					)}
					{if (view === 'compiled') (
						<select
							class="pg-select pg-output-select"
							aria-label="Compiler output"
							bind:value={target}
							onchange={onTargetChange}
						>
							<option value="client">Client</option>
							<option value="server">Server</option>
							<option value="types">Types</option>
						</select>
					)}
					{if (view === 'compiled') (
						<div class="pg-seg pg-seg-sm" role="group" aria-label="Output format">
							<button
								type="button"
								class={['pg-seg-btn', compiledMode === 'code' && 'active']}
								onclick={() => onSelectCompiledMode('code')}
							>
								Code
							</button>
							<button
								type="button"
								class={['pg-seg-btn', compiledMode === 'ast' && 'active']}
								onclick={() => onSelectCompiledMode('ast')}
							>
								AST
							</button>
						</div>
					)}
				</div>
			</div>
			<div class={['pg-result', view !== 'preview' && 'hidden']}>
				{preview}
				<div class={['pg-devtools', !devtoolsOpen && 'collapsed']} aria-hidden={devtoolsOpen ? 'false' : 'true'}>
					{devtools}
				</div>
				{if (gated) (<ConsentOverlay ready={ready} onApprove={onApproveRun} />)}
			</div>
			<div class={['pg-compiled', view !== 'compiled' && 'hidden']}>
				<div class={['pg-ast-host', compiledMode !== 'ast' && 'hidden']}>{ast}</div>
				<div class={['pg-output', compiledMode !== 'code' && 'hidden']}>{output}</div>
			</div>
		</section>
	)
}

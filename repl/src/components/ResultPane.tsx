// The right panel: a live-preview mode (sandboxed iframe + the shared-code
// consent gate) and a compiled mode (Client/Server/Types artifact as code or
// an AST tree). The CodeMirror output editor and the AST tree are mounted into
// their host divs by the engine's boot effect (see use-playground.ts).
import type { RefObject } from 'react';
import { cx } from '../utils/cx.ts';
import { OUTPUT_TARGET_LABEL } from '../utils/use-playground.ts';
import type { PlaygroundController, PlaygroundEngine } from '../utils/use-playground.ts';
import type { PlaygroundOutputTarget } from '../utils/playground.ts';
import { ConsentOverlay } from './ConsentOverlay.tsx';

interface ResultPaneProps {
	pane: 'editor' | 'result';
	view: 'preview' | 'compiled';
	compiledMode: 'code' | 'ast';
	outputTarget: PlaygroundOutputTarget;
	gated: boolean;
	ready: boolean;
	activeFile: string;
	previewHostRef: RefObject<HTMLDivElement | null>;
	astHostRef: RefObject<HTMLDivElement | null>;
	outputHostRef: RefObject<HTMLDivElement | null>;
	controller: PlaygroundController;
	onSelectCompiledMode: PlaygroundEngine['selectCompiledMode'];
	onSelectOutputTarget: PlaygroundEngine['selectOutputTarget'];
}

export function ResultPane({
	pane,
	view,
	compiledMode,
	outputTarget,
	gated,
	ready,
	activeFile,
	previewHostRef,
	astHostRef,
	outputHostRef,
	controller,
	onSelectCompiledMode,
	onSelectOutputTarget,
}: ResultPaneProps) {
	return (
		<section className={cx('pg-panel', pane !== 'result' && 'mobile-hidden')} aria-label="Result">
			<div className="pg-panel-head">
				<span>
					{view === 'preview'
						? 'Live preview'
						: OUTPUT_TARGET_LABEL[outputTarget] +
							(compiledMode === 'ast' ? ' AST · ' : ' output · ') +
							(activeFile || '…')}
				</span>
				{view === 'compiled' && (
					<div className="pg-compiled-controls">
						<select
							className="pg-select pg-output-select"
							aria-label="Compiler output"
							value={outputTarget}
							onChange={(event) =>
								onSelectOutputTarget(event.currentTarget.value as PlaygroundOutputTarget)
							}
						>
							<option value="client">Client</option>
							<option value="server">Server</option>
							<option value="types">Types</option>
						</select>
						<div className="pg-seg pg-seg-sm" role="group" aria-label="Output format">
							<button
								type="button"
								className={cx('pg-seg-btn', compiledMode === 'code' && 'active')}
								onClick={() => onSelectCompiledMode('code')}
							>
								Code
							</button>
							<button
								type="button"
								className={cx('pg-seg-btn', compiledMode === 'ast' && 'active')}
								onClick={() => onSelectCompiledMode('ast')}
							>
								AST
							</button>
						</div>
					</div>
				)}
			</div>
			<div className={cx('pg-result', view !== 'preview' && 'hidden')}>
				<div className="pg-preview" ref={previewHostRef} />
				{gated && <ConsentOverlay ready={ready} onApprove={() => controller.approveRun?.()} />}
			</div>
			<div className={cx('pg-compiled', view !== 'compiled' && 'hidden')}>
				<div className={cx('pg-ast-host', compiledMode !== 'ast' && 'hidden')} ref={astHostRef} />
				<div className={cx('pg-output', compiledMode !== 'code' && 'hidden')}>
					<div className="pg-editor" ref={outputHostRef} />
				</div>
			</div>
		</section>
	);
}
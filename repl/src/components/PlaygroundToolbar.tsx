// The page's toolbar: the Examples dropdown, the Format button, and the
// desktop Preview/Compiled view switch. All of it is presentational — actions
// route through the engine's controller (see use-playground.ts).
import { cx } from '../utils/cx.ts';
import { EXAMPLE_GROUPS } from '../utils/example-groups.ts';
import type { PlaygroundController } from '../utils/use-playground.ts';

interface PlaygroundToolbarProps {
	ready: boolean;
	formatting: boolean;
	exampleId: string;
	view: 'preview' | 'compiled';
	controller: PlaygroundController;
	onSelectView: (next: 'preview' | 'compiled') => void;
}

export function PlaygroundToolbar({
	ready,
	formatting,
	exampleId,
	view,
	controller,
	onSelectView,
}: PlaygroundToolbarProps) {
	return (
		<div className="pg-toolbar">
			<div className="pg-toolbar-side">
				<select
					className="pg-select"
					aria-label="Example"
					disabled={!ready}
					value={exampleId}
					onChange={(e) => controller.selectExample?.(e.currentTarget.value)}
				>
					{/* Static placeholder shown only while the buffer has diverged from
    every example — always in the DOM (no conditional rendering
    inside the select) so the option list never reconciles. */}
					<option value="custom" disabled hidden>
						Custom
					</option>
					{EXAMPLE_GROUPS.map((group) => (
						<optgroup key={group.group} label={group.group}>
							{group.examples.map((example) => (
								<option key={example.id} value={example.id}>
									{example.label}
								</option>
							))}
						</optgroup>
					))}
				</select>
				<button
					type="button"
					className="pg-format"
					disabled={!ready || formatting}
					title="Format with Prettier (Ctrl/Cmd-Shift-F)"
					onClick={() => controller.formatActive?.()}
				>
					{formatting ? 'Formatting…' : 'Format'}
				</button>
			</div>
			<div className="pg-seg pg-view-switch" role="group" aria-label="Result view">
				<button
					type="button"
					className={cx('pg-seg-btn', view === 'preview' && 'active')}
					onClick={() => onSelectView('preview')}
				>
					Preview
				</button>
				<button
					type="button"
					className={cx('pg-seg-btn', view === 'compiled' && 'active')}
					onClick={() => onSelectView('compiled')}
				>
					Compiled
				</button>
			</div>
		</div>
	);
}
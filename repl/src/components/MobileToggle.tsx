// Mobile-only: the floating bottom toggle that picks which of the two panels
// is visible (desktop always shows both). Preview and Inspect are the two
// result views; Code returns to the editor.
import { cx } from '../utils/cx.ts';

interface MobileToggleProps {
	pane: 'editor' | 'result';
	view: 'preview' | 'compiled';
	onEditor: () => void;
	onPreview: () => void;
	onCompiled: () => void;
}

export function MobileToggle({ pane, view, onEditor, onPreview, onCompiled }: MobileToggleProps) {
	return (
		<div className="pg-mobile-toggle" role="group" aria-label="Visible panel">
			<button
				type="button"
				className={cx('pg-seg-btn', pane === 'editor' && 'active')}
				onClick={onEditor}
			>
				Code
			</button>
			<button
				type="button"
				className={cx('pg-seg-btn', pane === 'result' && view === 'preview' && 'active')}
				onClick={onPreview}
			>
				Preview
			</button>
			<button
				type="button"
				className={cx('pg-seg-btn', pane === 'result' && view === 'compiled' && 'active')}
				title="Show the compiled output for the current file"
				onClick={onCompiled}
			>
				Inspect
			</button>
		</div>
	);
}
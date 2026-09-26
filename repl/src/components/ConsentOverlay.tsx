// The gate over the preview when a hash-shared payload is loaded but not yet
// approved: shared code stays sandboxed, and only a deliberate "Run code"
// click executes it.
interface ConsentOverlayProps {
	ready: boolean;
	onApprove: () => void;
}

export function ConsentOverlay({ ready, onApprove }: ConsentOverlayProps) {
	return (
		<div className="pg-consent" role="alertdialog" aria-label="Run shared code?">
			<div className="pg-consent-card">
				<strong>This link contains shared code.</strong>
				<p>
					It was written by whoever sent you this link. Review it in the editor (and the
					compiled output) — it runs in a sandbox, but only after you choose to run it.
				</p>
				<button type="button" className="pg-consent-run" disabled={!ready} onClick={onApprove}>
					Run code
				</button>
			</div>
		</div>
	);
}
// The gate over the preview when a shared-code payload is loaded but not yet
// approved: shared code stays sandboxed, and only a deliberate "Run code"
// click executes it. Reserved for shared-link payloads — nothing gates the
// default workspaces in this build.
export component ConsentOverlay(ready: boolean, onApprove: () => void) {
	render (
		<div class="pg-consent" role="alertdialog" aria-label="Run shared code?">
			<div class="pg-consent-card">
				<strong>This link contains shared code.</strong>
				<p>
					It was written by whoever sent you this link. Review it in the editor (and the
					compiled output) — it runs in a sandbox, but only after you choose to run it.
				</p>
				<button type="button" class="pg-consent-run" disabled={!ready} onclick={onApprove}>
					Run code
				</button>
			</div>
		</div>
	)
}

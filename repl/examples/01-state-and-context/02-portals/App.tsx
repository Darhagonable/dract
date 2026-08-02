import { createPortal, useState } from 'octane';

// createPortal(Component, target, props) renders into another DOM subtree
// — here document.body — while events still bubble through the COMPONENT
// tree, so the demo's own handlers see clicks from inside the toast.
function Toast(props: { onDismiss: () => void }) {
	return (
		<aside
			role="status"
			style={{
				position: 'fixed',
				right: '1rem',
				bottom: '1rem',
				display: 'flex',
				gap: '0.75rem',
				alignItems: 'center',
				padding: '0.6rem 0.9rem',
				borderRadius: '10px',
				border: '1px solid #8886',
				background: '#22262e',
				color: '#f4eee8',
				boxShadow: '0 8px 24px #0006',
			}}
		>
			<p style={{ margin: 0 }}>Draft saved.</p>
			<button onClick={props.onDismiss}>Dismiss</button>
		</aside>
	);
}

export default function App() {
	const [toastOpen, setToastOpen] = useState(false);

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<button onClick={() => setToastOpen(true)}>Save draft</button>

			{toastOpen
				? createPortal(Toast, document.body, { onDismiss: () => setToastOpen(false) })
				: null}

			<p style={{ opacity: 0.6 }}>
				The toast mounts at the end of document.body — inspect the preview to see it
				escape this component's DOM.
			</p>
		</div>
	);
}

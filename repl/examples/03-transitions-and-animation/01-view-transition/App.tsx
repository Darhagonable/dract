import { useEffect, useState, startTransition, ViewTransition } from 'octane';

// <ViewTransition> animates enter/exit through the browser's View
// Transition API — wrap the element, name the animations, and make the
// state change inside startTransition. Browsers without the native API
// simply skip the animation. The ::view-transition keyframes are global
// CSS, injected once by the effect below.
export default function App() {
	const [visible, setVisible] = useState(true);

	useEffect(() => {
		const style = document.createElement('style');
		style.textContent = `
			::view-transition-new(.card-in) {
				animation: card-in 400ms cubic-bezier(0.16, 1, 0.3, 1) both;
			}
			::view-transition-old(.card-out) {
				animation: card-out 260ms cubic-bezier(0.4, 0, 1, 1) both;
			}
			@keyframes card-in {
				from { opacity: 0; transform: translateY(14px) scale(0.8); }
			}
			@keyframes card-out {
				to { opacity: 0; transform: translateY(14px) scale(0.8); }
			}
		`;
		document.head.appendChild(style);
		return () => style.remove();
	}, []);

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<button onClick={() => startTransition(() => setVisible(!visible))}>
				{visible ? 'Remove card' : 'Add card'}
			</button>

			<div style={{ minHeight: '4rem' }}>
				{visible ? (
					<ViewTransition enter="card-in" exit="card-out">
						<div
							style={{
								padding: '1rem 1.5rem',
								borderRadius: '10px',
								border: '1px solid #8886',
								background: '#22262e',
							}}
						>
							I animate in and out
						</div>
					</ViewTransition>
				) : null}
			</div>
		</div>
	);
}

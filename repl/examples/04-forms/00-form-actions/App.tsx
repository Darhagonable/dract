import { useActionState, useFormStatus } from 'octane';

// <form action={fn}> + useActionState wires an async action to the form;
// useFormStatus lets any child read the in-flight state without prop
// drilling.
async function saveName(previous: string, formData: FormData) {
	const name = String(formData.get('name') ?? '').trim();
	if (!name) return 'Enter a name before saving.';

	// Stand-in for a real request.
	await new Promise((resolve) => setTimeout(resolve, 700));
	return 'Saved ' + name + '.';
}

function SubmitButton() {
	const status = useFormStatus();

	return (
		<button type="submit" disabled={status.pending}>
			{status.pending ? 'Saving…' : 'Save'}
		</button>
	);
}

export default function App() {
	const [message, submit] = useActionState(saveName, '');

	return (
		<form action={submit} style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<label style={{ display: 'grid', gap: '0.25rem' }}>
				Name
				<input
					name="name"
					defaultValue="Ada"
					style={{
						padding: '0.3rem 0.5rem',
						borderRadius: '6px',
						border: '1px solid #8886',
						background: 'transparent',
						color: 'inherit',
					}}
				/>
			</label>

			<SubmitButton />

			{message ? <p role="status" style={{ margin: 0 }}>{message}</p> : null}
		</form>
	);
}

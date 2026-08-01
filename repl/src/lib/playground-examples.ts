// Curated playground examples. Every source here compiles warning-free
// through the real pipeline (playground-modules.ts) — enforced by
// tests/playground-examples.test.ts — so keep new examples runnable and
// minimal: each demonstrates one API surface, not a whole app.
//
// File kinds are derived from the file name (see playground-modules.ts):
// `.tsx` compiles with the octane compiler; `.react.tsx` marks a React-HOST
// file (sucrase react-jsx transform) used by the OctaneCompat example,
// where real react-dom from esm.sh renders the entry.
import type { PlaygroundFile } from './playground-modules.ts';

export interface ExampleWorkspace {
	files: PlaygroundFile[];
	/** Module the sandbox imports and renders. Defaults to the first file. */
	entry: string;
}

export interface PlaygroundExample {
	id: string;
	label: string;
	/** Dropdown <optgroup> label. */
	group: string;
	workspace: ExampleWorkspace;
}

function workspace(files: PlaygroundFile[], entry = files[0].name): ExampleWorkspace {
	return { files, entry };
}

// ── Basics ──────────────────────────────────────────────────────────────────

const COUNTER_TSX = `import { useState } from 'octane';

export default function App() {
	const [count, setCount] = useState(0);
	const [items, setItems] = useState<string[]>([]);

	const addItem = () => {
		setItems([...items, 'Item #' + (items.length + 1)]);
	};

	return (
		<div style={{ display: 'grid', gap: '0.5rem', justifyItems: 'start' }}>
			<h2>{'Count: ' + count}</h2>

			<button onClick={() => setCount(count + 1)}>Increment</button>
			<button onClick={addItem}>Add item</button>

			{count >= 5 ? <p style={{ color: '#ff5d72' }}>Count is heating up!</p> : null}

			<ul style={{ margin: 0 }}>
				{items.length === 0 ? (
					<li style={{ opacity: 0.6 }}>No items yet — add one.</li>
				) : (
					items.map((item) => <li key={item}>{item}</li>)
				)}
			</ul>
		</div>
	);
}
`;

const LIST_TSX = `import { useState } from 'octane';

// The same keyed list in React-style TSX — .map() with key props instead
// of the @for directive. Both dialects compile to the same runtime.
export default function App() {
	const [items, setItems] = useState([
		{ id: 1, label: 'apple' },
		{ id: 2, label: 'banana' },
		{ id: 3, label: 'cherry' },
	]);
	const [nextId, setNextId] = useState(4);

	const add = (position: 'start' | 'end') => {
		const item = { id: nextId, label: 'item ' + nextId };
		setNextId(nextId + 1);
		setItems(position === 'start' ? [item, ...items] : [...items, item]);
	};

	return (
		<div style={{ display: 'grid', gap: '0.75rem' }}>
			<div style={{ display: 'flex', gap: '0.5rem' }}>
				<button onClick={() => add('start')}>Prepend</button>
				<button onClick={() => add('end')}>Append</button>
				<button onClick={() => setItems([...items].reverse())}>Reverse</button>
				<button onClick={() => setItems([])}>Clear</button>
			</div>

			<ul style={{ margin: 0 }}>
				{items.length === 0 ? (
					<li style={{ opacity: 0.6 }}>Empty — add an item above.</li>
				) : (
					items.map((item) => (
						<li key={item.id}>
							{item.label}
							<button onClick={() => setItems(items.filter((x) => x.id !== item.id))}>
								×
							</button>
						</li>
					))
				)}
			</ul>
		</div>
	);
}
`;

const INPUTS_TSX = `import { useState } from 'octane';

// Controlled inputs on NATIVE events: onInput fires per keystroke for text
// controls (there is no synthetic onChange layer), while selects and
// checkboxes use the platform's own change event.
export default function App() {
	const [name, setName] = useState('world');
	const [kind, setKind] = useState('plain');
	const [loud, setLoud] = useState(false);

	const greeting = () => {
		switch (kind) {
			case 'shout':
				return 'HELLO, ' + name.toUpperCase() + (loud ? '!!!' : '!');
			case 'whisper':
				return 'hello, ' + name.toLowerCase() + '…';
			default:
				return 'hello, ' + name;
		}
	};

	return (
		<div style={{ display: 'grid', gap: '0.75rem' }}>
			<div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
				<input value={name} onInput={(e) => setName(e.currentTarget.value)} />

				<select value={kind} onChange={(e) => setKind(e.currentTarget.value)}>
					<option value="plain">plain</option>
					<option value="shout">shout</option>
					<option value="whisper">whisper</option>
				</select>

				<label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
					<input
						type="checkbox"
						checked={loud}
						onChange={(e) => setLoud(e.currentTarget.checked)}
					/>
					extra loud
				</label>
			</div>

			<div
				style={{
					padding: '0.75rem',
					border: '1px solid #8884',
					borderRadius: '8px',
					fontWeight: kind === 'shout' ? 700 : undefined,
					opacity: kind === 'whisper' ? 0.6 : undefined,
					fontStyle: kind === 'whisper' ? 'italic' : undefined,
				}}
			>
				<p style={{ margin: 0 }}>{greeting()}</p>
			</div>
		</div>
	);
}
`;

// ── State & context ─────────────────────────────────────────────────────────

const BRANCH_HOOKS_TSX = `import { useState } from 'octane';

// Octane has no rules of hooks: hooks are keyed by call SITE, not call
// order, so useState may live inside an inline expression. The counter's
// state is bound to that call site, so it survives the branch collapsing —
// collapse and re-expand to watch it persist. (React cannot express this.)
export default function App() {
	const [open, setOpen] = useState(true);

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<button onClick={() => setOpen(!open)}>{open ? 'Collapse' : 'Expand'}</button>

			{open ? (
				(() => {
					const [bumps, setBumps] = useState(0);

					return (
						<div
							style={{
								padding: '0.75rem',
								border: '1px solid #8884',
								borderRadius: '8px',
								display: 'grid',
								gap: '0.5rem',
								justifyItems: 'start',
							}}
						>
							<p style={{ margin: 0 }}>{'Branch-local bumps: ' + bumps}</p>
							<button onClick={() => setBumps(bumps + 1)}>Bump</button>
						</div>
					);
				})()
			) : (
				<p style={{ opacity: 0.6 }}>
					Collapsed — the counter keeps its state because its call site never moves.
				</p>
			)}
		</div>
	);
}
`;

const CONTEXT_TSX = `import { createContext, use, useState } from 'octane';

const Theme = createContext('light');

function ThemeCard() {
	const theme = use(Theme);

	return (
		<div
			style={{
				padding: '0.75rem 1rem',
				borderRadius: '8px',
				border: '1px solid #8884',
				background: theme === 'dark' ? '#101318' : '#f6f2ea',
				color: theme === 'dark' ? '#f4eee8' : '#1c1b18',
			}}
		>
			<p>{'The current theme is ' + theme + '.'}</p>
		</div>
	);
}

export default function App() {
	const [theme, setTheme] = useState('light');

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
				Switch theme
			</button>

			<Theme.Provider value={theme}>
				<ThemeCard />
			</Theme.Provider>

			<ThemeCard />
			<p style={{ opacity: 0.6 }}>
				The second card sits outside the provider, so it sees the fallback.
			</p>
		</div>
	);
}
`;

const PORTAL_TSX = `import { createPortal, useState } from 'octane';

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
`;

const DYNAMIC_TAGS_TSX = `import { useState } from 'octane';

// Rendering a component chosen from a table through a variable. Swapping
// the variable remounts just that slot's subtree — the parent never
// re-renders.
function Red(props: { label: string }) {
	return (
		<span
			style={{
				padding: '0.35rem 0.75rem',
				borderRadius: '6px',
				background: '#fee2e2',
				color: '#991b1b',
			}}
		>
			{'red: ' + props.label}
		</span>
	);
}

function Blue(props: { label: string }) {
	return (
		<span
			style={{
				padding: '0.35rem 0.75rem',
				borderRadius: '6px',
				background: '#dbeafe',
				color: '#1e40af',
			}}
		>
			{'blue: ' + props.label}
		</span>
	);
}

function Green(props: { label: string }) {
	return (
		<span
			style={{
				padding: '0.35rem 0.75rem',
				borderRadius: '6px',
				background: '#d1fae5',
				color: '#065f46',
			}}
		>
			{'green: ' + props.label}
		</span>
	);
}

const CHIPS = { red: Red, blue: Blue, green: Green };

export default function App() {
	const [which, setWhich] = useState<keyof typeof CHIPS>('red');
	const Chip = CHIPS[which];

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<div style={{ display: 'flex', gap: '0.5rem' }}>
				<button onClick={() => setWhich('red')}>red</button>
				<button onClick={() => setWhich('blue')}>blue</button>
				<button onClick={() => setWhich('green')}>green</button>
			</div>

			<div style={{ padding: '0.75rem', border: '1px solid #8884', borderRadius: '8px' }}>
				<Chip label="live swap" />
			</div>
		</div>
	);
}
`;

// ── Async & Suspense ────────────────────────────────────────────────────────

const SUSPENSE_TSX = `import { useState, use, Suspense, ErrorBoundary } from 'octane';

// <Suspense> + <ErrorBoundary> components for async data. use() suspends
// the boundary until the promise settles; a rejection routes to the
// boundary's fallback.
function fakeFetch(shouldFail: boolean, attempt: number) {
	return new Promise<string>((resolve, reject) => {
		setTimeout(() => {
			if (shouldFail) reject(new Error('simulated fetch failure'));
			else resolve('response #' + attempt + ': shipping is the feature');
		}, 800);
	});
}

// Creating the promise AT the use() call site lets octane memoize it per
// call site + deps — only changed inputs refetch; unrelated re-renders
// never resuspend the boundary.
function Quote(props: { shouldFail: boolean; attempt: number }) {
	const quote = use(fakeFetch(props.shouldFail, props.attempt));

	return <p>{'“' + quote + '”'}</p>;
}

export default function App() {
	const [attempt, setAttempt] = useState(1);
	const [shouldFail, setShouldFail] = useState(false);

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
				<button onClick={() => setAttempt(attempt + 1)}>Refetch</button>
				<label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
					<input
						type="checkbox"
						checked={shouldFail}
						onChange={(e) => setShouldFail(e.currentTarget.checked)}
					/>
					simulate failure
				</label>
			</div>

			<ErrorBoundary
				fallback={(error: Error) => <p style={{ color: '#ff5d72' }}>{error.message}</p>}
			>
				<Suspense fallback={<p style={{ opacity: 0.6 }}>loading…</p>}>
					<Quote shouldFail={shouldFail} attempt={attempt} />
				</Suspense>
			</ErrorBoundary>
		</div>
	);
}
`;

const PARALLEL_USE_APP_TSX = `import { useState, use, Suspense, ErrorBoundary } from 'octane';
import { fetchCity, fetchForecast } from './Data.tsx';

// Octane's parallel use(): provably-independent promises created for the
// same boundary START TOGETHER and the boundary suspends once — two 700ms
// fetches settle in ~700ms, not ~1400ms. React runs the same code as a
// serial waterfall.
function Dashboard(props: { attempt: number }) {
	const city = use(fetchCity(props.attempt));
	const forecast = use(fetchForecast(props.attempt));

	return (
		<>
			<p style={{ margin: 0 }}>{'City: ' + city}</p>
			<p style={{ margin: 0 }}>{'Forecast: ' + forecast}</p>
		</>
	);
}

function Elapsed(props: { since: number }) {
	const ms = Math.round(performance.now() - props.since);

	return (
		<p style={{ opacity: 0.6, margin: 0 }}>
			{'Both resolved after ~' + ms + 'ms — two 700ms fetches, one round.'}
		</p>
	);
}

export default function App() {
	const [attempt, setAttempt] = useState(1);
	const [startedAt, setStartedAt] = useState(() => performance.now());

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<button
				onClick={() => {
					setStartedAt(performance.now());
					setAttempt(attempt + 1);
				}}
			>
				Reload both
			</button>

			<div style={{ padding: '0.75rem', border: '1px solid #8884', borderRadius: '8px' }}>
				<ErrorBoundary
					fallback={(error: Error) => <p style={{ color: '#ff5d72' }}>{error.message}</p>}
				>
					<Suspense fallback={<p style={{ opacity: 0.6, margin: 0 }}>loading both…</p>}>
						<Dashboard attempt={attempt} />
						<Elapsed since={startedAt} />
					</Suspense>
				</ErrorBoundary>
			</div>
		</div>
	);
}
`;

const PARALLEL_USE_DATA_TSX = `// Fake API module — each call takes 700ms. Because the two fetches are
// independent, octane starts them in parallel for the same boundary.
function delay<T>(ms: number, value: T): Promise<T> {
	return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export function fetchCity(attempt: number) {
	return delay(700, 'Reykjavík (' + attempt + ')');
}

export function fetchForecast(attempt: number) {
	return delay(700, 'aurora with a chance of drizzle (' + attempt + ')');
}
`;

// ── Transitions & animation ─────────────────────────────────────────────────

const TRANSITIONS_TSX = `import { useState, useDeferredValue, useTransition } from 'octane';

// useDeferredValue lets the slow list lag one step behind the input, and
// useTransition keeps the UI responsive while a heavy update commits.
const WORDS = ['ember', 'orchid', 'quartz', 'saffron', 'thistle', 'umbra', 'verdant', 'willow'];
const ITEMS = Array.from({ length: 1500 }, (_, i) => WORDS[i % WORDS.length] + '-' + i);

function SlowList(props: { query: string }) {
	// Artificial cost so the deferral is visible.
	const start = performance.now();
	while (performance.now() - start < 40) {
		// busy-wait ~40ms per render
	}
	const matches = ITEMS.filter((item) => item.includes(props.query)).slice(0, 12);

	if (matches.length === 0) return <li style={{ opacity: 0.6 }}>no matches</li>;

	return (
		<ul style={{ margin: 0 }}>
			{matches.map((item) => (
				<li key={item}>{item}</li>
			))}
		</ul>
	);
}

export default function App() {
	const [query, setQuery] = useState('');
	const deferredQuery = useDeferredValue(query);
	const [isPending, startTransition] = useTransition();
	const [sorted, setSorted] = useState(false);
	const isStale = query !== deferredQuery;

	return (
		<div style={{ display: 'grid', gap: '0.75rem' }}>
			<div style={{ display: 'flex', gap: '0.5rem' }}>
				<input
					placeholder="type to filter 1500 items…"
					value={query}
					onInput={(e) => setQuery(e.currentTarget.value)}
					style={{
						padding: '0.3rem 0.5rem',
						borderRadius: '6px',
						border: '1px solid #8886',
						background: 'transparent',
						color: 'inherit',
						minWidth: '16rem',
					}}
				/>
				<button onClick={() => startTransition(() => setSorted(!sorted))}>
					{isPending ? 'Sorting…' : sorted ? 'Unsort' : 'Sort'}
				</button>
			</div>

			<div
				style={{
					padding: '0.75rem',
					border: '1px solid #8884',
					borderRadius: '8px',
					transition: 'opacity 0.15s',
					opacity: isStale ? 0.5 : undefined,
				}}
			>
				<SlowList query={sorted ? deferredQuery.split('').sort().join('') : deferredQuery} />
			</div>
		</div>
	);
}
`;

const VIEW_TRANSITION_TSX = `import { useEffect, useState, startTransition, ViewTransition } from 'octane';

// <ViewTransition> animates enter/exit through the browser's View
// Transition API — wrap the element, name the animations, and make the
// state change inside startTransition. Browsers without the native API
// simply skip the animation. The ::view-transition keyframes are global
// CSS, injected once by the effect below.
export default function App() {
	const [visible, setVisible] = useState(true);

	useEffect(() => {
		const style = document.createElement('style');
		style.textContent = \`
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
		\`;
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
`;

// ── Forms ───────────────────────────────────────────────────────────────────

const FORM_ACTIONS_TSX = `import { useActionState, useFormStatus } from 'octane';

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
`;

// ── Ecosystem ───────────────────────────────────────────────────────────────

const ESM_SH_TSX = `import { useSyncExternalStore } from 'octane';
import { createStore } from 'zustand/vanilla';

// Third-party imports work in the playground: bare specifiers resolve
// through esm.sh (this one becomes https://esm.sh/zustand/vanilla).
// useSyncExternalStore subscribes octane to the external store.
const store = createStore<{ count: number }>(() => ({ count: 0 }));

const increment = () => store.setState((state) => ({ count: state.count + 1 }));
const reset = () => store.setState({ count: 0 });

export default function App() {
	const count = useSyncExternalStore(store.subscribe, () => store.getState().count);

	return (
		<div style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}>
			<h2 style={{ margin: 0 }}>{'Zustand count: ' + count}</h2>

			<div style={{ display: 'flex', gap: '0.5rem' }}>
				<button onClick={increment}>Increment</button>
				<button onClick={reset}>Reset</button>
			</div>

			<p style={{ opacity: 0.6 }}>
				The store lives outside octane entirely — any subscriber sees the same state.
			</p>
		</div>
	);
}
`;

const OCTANE_COMPAT_HOST = `import { useState } from 'react';
import { OctaneCompat } from 'octane/react';
import { Island } from './Island.tsx';

// This file is a REACT host — real react-dom (from esm.sh) renders it.
// <OctaneCompat> mounts the compiled Octane island inside the React tree;
// events inside the island are native and bubble through to React
// ancestors, and the island runs its own Suspense boundary.
export default function App() {
	const [mounted, setMounted] = useState(true);
	const [hostClicks, setHostClicks] = useState(0);

	return (
		<main
			style={{ display: 'grid', gap: '0.75rem', justifyItems: 'start' }}
			onClick={() => setHostClicks((clicks) => clicks + 1)}
		>
			<h2 style={{ margin: 0 }}>React 19 host</h2>
			<p style={{ margin: 0, opacity: 0.7 }}>
				{'Clicks seen by the React host (bubbled from anywhere below): ' + hostClicks}
			</p>

			<button onClick={() => setMounted((value) => !value)}>
				{mounted ? 'Unmount island' : 'Mount island'}
			</button>

			{mounted ? (
				<OctaneCompat>
					<Island start={3} />
				</OctaneCompat>
			) : null}
		</main>
	);
}
`;

const OCTANE_COMPAT_ISLAND = `import { useState, use, Suspense, ErrorBoundary } from 'octane';

// A compiled Octane island hosted by the React tree in App.react.tsx.
// It keeps its own state, native events, and Suspense boundary.
function fakeFetch(attempt: number) {
	return new Promise<string>((resolve) => {
		setTimeout(() => resolve('island data #' + attempt), 700);
	});
}

// Creating the promise AT the use() call site lets octane memoize it per
// call site + deps, so unrelated re-renders (the click counter) never
// resuspend the boundary — only a changed attempt refetches.
function IslandData(props: { attempt: number }) {
	const data = use(fakeFetch(props.attempt));

	return <p style={{ margin: 0 }}>{data}</p>;
}

export function Island(props: { start: number }) {
	const [count, setCount] = useState(props.start);
	const [attempt, setAttempt] = useState(1);

	return (
		<section
			style={{
				padding: '0.9rem 1.1rem',
				border: '1px dashed #ff5d72aa',
				borderRadius: '10px',
				display: 'grid',
				gap: '0.5rem',
				justifyItems: 'start',
			}}
		>
			<h3 style={{ margin: 0, color: '#ff5d72' }}>Octane island</h3>

			<div style={{ display: 'flex', gap: '0.5rem' }}>
				<button onClick={() => setCount(count + 1)}>{'clicks: ' + count}</button>
				<button onClick={() => setAttempt(attempt + 1)}>Refetch</button>
			</div>

			<ErrorBoundary
				fallback={(error: Error) => <p style={{ margin: 0, color: '#ff5d72' }}>{error.message}</p>}
			>
				<Suspense fallback={<p style={{ margin: 0, opacity: 0.6 }}>island loading…</p>}>
					<IslandData attempt={attempt} />
				</Suspense>
			</ErrorBoundary>
		</section>
	);
}
`;

// ── Catalogue ───────────────────────────────────────────────────────────────

export const CUSTOM_EXAMPLE_ID = 'custom';
export const DEFAULT_EXAMPLE_ID = 'counter';

export const EXAMPLES: PlaygroundExample[] = [
	{
		id: 'counter',
		label: 'Counter',
		group: 'Basics',
		workspace: workspace([{ name: 'App.tsx', source: COUNTER_TSX }]),
	},
	{
		id: 'keyed-list',
		label: 'Keyed lists',
		group: 'Basics',
		workspace: workspace([{ name: 'App.tsx', source: LIST_TSX }]),
	},
	{
		id: 'inputs',
		label: 'Inputs',
		group: 'Basics',
		workspace: workspace([{ name: 'App.tsx', source: INPUTS_TSX }]),
	},
	{
		id: 'branch-hooks',
		label: 'Branch-local hooks',
		group: 'State & context',
		workspace: workspace([{ name: 'App.tsx', source: BRANCH_HOOKS_TSX }]),
	},
	{
		id: 'context',
		label: 'Context',
		group: 'State & context',
		workspace: workspace([{ name: 'App.tsx', source: CONTEXT_TSX }]),
	},
	{
		id: 'portals',
		label: 'Portals',
		group: 'State & context',
		workspace: workspace([{ name: 'App.tsx', source: PORTAL_TSX }]),
	},
	{
		id: 'dynamic-tags',
		label: 'Dynamic components',
		group: 'State & context',
		workspace: workspace([{ name: 'App.tsx', source: DYNAMIC_TAGS_TSX }]),
	},
	{
		id: 'suspense',
		label: 'Suspense + use()',
		group: 'Async & Suspense',
		workspace: workspace([{ name: 'App.tsx', source: SUSPENSE_TSX }]),
	},
	{
		id: 'parallel-use',
		label: 'Parallel use() (multi-file)',
		group: 'Async & Suspense',
		workspace: workspace(
			[
				{ name: 'App.tsx', source: PARALLEL_USE_APP_TSX },
				{ name: 'Data.tsx', source: PARALLEL_USE_DATA_TSX },
			],
			'App.tsx',
		),
	},
	{
		id: 'transitions',
		label: 'Transitions & deferred values',
		group: 'Transitions & animation',
		workspace: workspace([{ name: 'App.tsx', source: TRANSITIONS_TSX }]),
	},
	{
		id: 'view-transition',
		label: 'ViewTransition',
		group: 'Transitions & animation',
		workspace: workspace([{ name: 'App.tsx', source: VIEW_TRANSITION_TSX }]),
	},
	{
		id: 'form-actions',
		label: 'Form actions',
		group: 'Forms',
		workspace: workspace([{ name: 'App.tsx', source: FORM_ACTIONS_TSX }]),
	},
	{
		id: 'esm-sh',
		label: 'Third-party import (zustand)',
		group: 'Ecosystem',
		workspace: workspace([{ name: 'App.tsx', source: ESM_SH_TSX }]),
	},
	{
		id: 'octane-compat',
		label: 'OctaneCompat in React (multi-file)',
		group: 'Ecosystem',
		workspace: workspace(
			[
				{ name: 'App.react.tsx', source: OCTANE_COMPAT_HOST },
				{ name: 'Island.tsx', source: OCTANE_COMPAT_ISLAND },
			],
			'App.react.tsx',
		),
	},
];

export function getExample(id: string): PlaygroundExample | undefined {
	return EXAMPLES.find((example) => example.id === id);
}

/** Deep-copy an example workspace into a mutable workspace. */
export function exampleWorkspace(example: PlaygroundExample): ExampleWorkspace {
	return {
		entry: example.workspace.entry,
		files: example.workspace.files.map((file) => ({ ...file })),
	};
}

/** The workspace the playground boots with (counter example). */
export const DEFAULT_WORKSPACE: ExampleWorkspace = exampleWorkspace(
	getExample(DEFAULT_EXAMPLE_ID)!,
);

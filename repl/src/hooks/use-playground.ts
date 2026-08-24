// React adapter over the playground engine (see engine/create-engine.ts).
//
// The engine owns the domain: workspace, compiler, preview, editor stack, and
// the state slice it emits. This hook is deliberately thin — it mounts host
// divs, creates the engine once, mirrors engine state into React, and keeps
// PURE UI state (which panel is visible, devtools toggle, drag-reorder
// bookkeeping) locally. Components read from this hook and drive the engine
// through `commands`.
import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import type { PlaygroundOutputTarget } from '../kernel/runtime/preview.ts';
import {
	createPlaygroundEngine,
	type EngineState,
	type PlaygroundCommands,
} from '../engine/create-engine.ts';

export type { PlaygroundCommands } from '../engine/create-engine.ts';
export { OUTPUT_TARGET_LABEL } from '../engine/output-pane.ts';

export interface PlaygroundEngine {
	view: 'preview' | 'compiled';
	pane: 'editor' | 'result';
	paneRef: RefObject<'editor' | 'result'>;
	error: string;
	ready: boolean;
	formatting: boolean;
	gated: boolean;
	exampleId: string;
	files: string[];
	activeFile: string;
	inputValue: string;
	renameInputRef: RefObject<HTMLInputElement | null>;
	dragOverFile: string | null;
	draggingFileRef: MutableRefObject<string | null>;
	focusInputSignal: number;
	entryFile: string;
	compiledMode: 'code' | 'ast';
	outputTarget: PlaygroundOutputTarget;
	sourceHostRef: RefObject<HTMLDivElement | null>;
	outputHostRef: RefObject<HTMLDivElement | null>;
	astHostRef: RefObject<HTMLDivElement | null>;
	previewHostRef: RefObject<HTMLDivElement | null>;
	devtoolsHostRef: RefObject<HTMLDivElement | null>;
	/** Whether the devtools bottom panel (hosting the chii frontend) is open. */
	devtoolsOpen: boolean;
	controller: PlaygroundCommands;
	selectView: (next: 'preview' | 'compiled') => void;
	openMobilePreview: () => void;
	openMobileCompiled: () => void;
	selectCompiledMode: (mode: 'code' | 'ast') => void;
	selectOutputTarget: (target: PlaygroundOutputTarget) => void;
	setPane: (pane: 'editor' | 'result') => void;
	setInputValue: (value: string) => void;
	setDragOverFile: (file: string | null) => void;
	toggleDevtools: () => void;
}

const INITIAL_STATE: Omit<EngineState, 'exampleId'> = {
	error: '',
	ready: false,
	formatting: false,
	gated: false,
	files: [],
	activeFile: '',
	entryFile: '',
	focusInputSignal: 0,
};

export function usePlayground(): PlaygroundEngine {
	const [view, setView] = useState<'preview' | 'compiled'>('preview');
	// Mobile only: which panel is visible (desktop always shows both).
	const [pane, setPane] = useState<'editor' | 'result'>('editor');
	const paneRef = useRef<'editor' | 'result'>('editor');
	// The engine's emitted state, mirrored into React via subscribe.
	const [engineState, setEngineState] = useState<EngineState>({
		...INITIAL_STATE,
		exampleId: '',
	});
	const [engine, setEngine] = useState<ReturnType<typeof createPlaygroundEngine> | null>(null);

	// Svelte-REPL-style tabs: the ACTIVE tab's name is a live inline input —
	// this state is its value (kept in sync with the active file's name).
	const [inputValue, setInputValue] = useState('');
	const renameInputRef = useRef<HTMLInputElement | null>(null);
	// The file hovered while a drag reorder is in flight (highlights the tab
	// the dragged file will land on); the dragged file itself lives in a ref.
	const [dragOverFile, setDragOverFile] = useState<string | null>(null);
	const draggingFileRef = useRef<string | null>(null);
	// The compiled pane's mode: code view or AST view.
	const [compiledMode, setCompiledMode] = useState<'code' | 'ast'>('code');
	// The compiled pane's artifact target. Server and Types are placeholders.
	const [outputTarget, setOutputTarget] = useState<PlaygroundOutputTarget>('client');

	const sourceHostRef = useRef<HTMLDivElement | null>(null);
	const outputHostRef = useRef<HTMLDivElement | null>(null);
	const astHostRef = useRef<HTMLDivElement | null>(null);
	const previewHostRef = useRef<HTMLDivElement | null>(null);
	const devtoolsHostRef = useRef<HTMLDivElement | null>(null);
	// Whether the devtools panel under the preview is open. The frontend iframe
	// itself is created lazily on the first open (multi-MB CDN payload).
	const [devtoolsOpen, setDevtoolsOpen] = useState(false);

	// Boot the engine once the hosts exist; dispose on unmount.
	useEffect(() => {
		const sourceHost = sourceHostRef.current;
		const outputHost = outputHostRef.current;
		const astHost = astHostRef.current;
		const previewHost = previewHostRef.current;
		if (!sourceHost || !outputHost || !astHost || !previewHost) return;

		const instance = createPlaygroundEngine(
			{
				source: sourceHost,
				output: outputHost,
				ast: astHost,
				preview: previewHost,
				devtools: devtoolsHostRef.current,
			},
			{
				isResultPaneVisible: () =>
					paneRef.current === 'result' &&
					window.matchMedia('(max-width: 980px)').matches,
				onInputValue: setInputValue,
			},
		);
		setEngine(instance);
		// Capture the engine's current state (boot patches before we could
		// have subscribed) and then follow every subsequent change.
		setEngineState(instance.state);
		const unsubscribe = instance.subscribe(() => setEngineState(instance.state));
		return () => {
			unsubscribe();
			instance.dispose();
			setEngine(null);
		};
	}, []);

	const commands = engine?.commands ?? {};

	const selectView = (next: 'preview' | 'compiled') => {
		setView(next);
		if (!engine) return;
		engine.mode.view = next;
		engine.commands.syncOutput?.();
	};
	const openMobilePreview = () => {
		selectView('preview');
		paneRef.current = 'result';
		setPane('result');
	};
	// Mobile's third pane is the compiled view, showing the client emit of
	// the active file.
	const openMobileCompiled = () => {
		setView('compiled');
		paneRef.current = 'result';
		setPane('result');
		if (engine) {
			engine.mode.view = 'compiled';
			engine.commands.syncOutput?.();
		}
	};
	const selectCompiledMode = (modeValue: 'code' | 'ast') => {
		setCompiledMode(modeValue);
		if (!engine) return;
		engine.mode.mode = modeValue;
		engine.commands.syncOutput?.();
	};
	// Switching targets re-renders the compiled pane with the new artifact.
	const selectOutputTarget = (target: PlaygroundOutputTarget) => {
		setOutputTarget(target);
		if (!engine) return;
		engine.mode.target = target;
		engine.commands.syncOutput?.();
	};
	// Opening the panel lazily creates the devtools frontend iframe (the boot
	// handshake with the sandbox's chobitsu is handled inside the engine).
	const toggleDevtools = () => {
		setDevtoolsOpen((open) => {
			if (!open) commands.ensureDevtools?.();
			return !open;
		});
	};

	// Reveal only after the mobile result panel has committed as visible;
	// scrollIntoView cannot position a node while its panel is display:none.
	useEffect(() => {
		if (
			engineState.ready && pane === 'result' && view === 'compiled' &&
			compiledMode === 'ast'
		) {
			commands.revealAst?.();
		}
	}, [engineState.ready, pane, view, compiledMode, outputTarget]);

	// Focus the active tab's name input after addFile bumped the signal.
	useEffect(() => {
		if (engineState.focusInputSignal > 0) renameInputRef.current?.focus();
	}, [engineState.focusInputSignal]);
	// Keep the live tab-name input in sync with the active file (tab
	// switches, example loads, deletions) — edits themselves flow the other
	// way, through the input's own handlers.
	useEffect(() => {
		setInputValue(engineState.activeFile);
	}, [engineState.activeFile]);

	return {
		view,
		pane,
		paneRef,
		error: engineState.error,
		ready: engineState.ready,
		formatting: engineState.formatting,
		gated: engineState.gated,
		exampleId: engineState.exampleId,
		files: engineState.files,
		activeFile: engineState.activeFile,
		inputValue,
		renameInputRef,
		dragOverFile,
		draggingFileRef,
		focusInputSignal: engineState.focusInputSignal,
		entryFile: engineState.entryFile,
		compiledMode,
		outputTarget,
		sourceHostRef,
		outputHostRef,
		astHostRef,
		previewHostRef,
		devtoolsHostRef,
		devtoolsOpen,
		controller: commands,
		selectView,
		openMobilePreview,
		openMobileCompiled,
		selectCompiledMode,
		selectOutputTarget,
		setPane,
		setInputValue,
		setDragOverFile,
		toggleDevtools,
	};
}

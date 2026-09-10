declare module 'monaco-editor-core/esm/vs/editor/editor.worker' {
	export function initialize<TContext, TCreateData, TResult>(
		callback: (context: TContext, createData: TCreateData) => TResult,
	): void;
}

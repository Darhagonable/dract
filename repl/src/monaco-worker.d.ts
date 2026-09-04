// monaco's worker entry has no bundled types (side-effect module: exports
// initialize(), which we call in dartsx.worker.ts).
declare module 'monaco-editor-core/esm/vs/editor/editor.worker' {
	export function initialize(create: (context: any, createData: any) => any): void;
}

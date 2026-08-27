// Message protocol between the repl main thread and the DarTsx language
// worker (dartsx.worker.ts). The codingame monaco fork removed monaco's
// createWebWorker machinery, so this is a hand-rolled transport: full-text
// sync (playground files are small; delta sync isn't worth the protocol)
// plus request/response passthrough for @volar/monaco's WorkerLanguageService
// methods — method names and args travel verbatim (LSP-shaped positions,
// toJSON'd monaco Uris), so no conversion happens on either side.

export interface SyncModel {
	uri: string;
	version: number;
	text: string;
}

export type WorkerInbound =
	| { type: 'init'; compilerOptions: Record<string, unknown> | null }
	| { type: 'sync'; models: SyncModel[] }
	| { type: 'request'; id: number; method: string; args: unknown[] }
	| { type: 'cancel'; id: number };

export type WorkerOutbound =
	| { type: 'ready' }
	| { type: 'synced' }
	| { type: 'response'; id: number; result?: unknown; error?: string };

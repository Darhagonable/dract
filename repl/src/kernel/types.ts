// Canonical domain types for the playground kernel. Everything under
// src/kernel/ is framework-free: no React, no CodeMirror, no DOM-UI concerns.
// UI layers (hooks/, components/) consume these types; the kernel never
// imports from them.

/** The single source dialect the playground accepts. */
export type PlaygroundLang = 'tsx';

/** One virtual file in a workspace. */
export interface PlaygroundFile {
	name: string;
	source: string;
}

/**
 * The workspace's tsconfig file name (Vue-REPL style): a plain virtual file
 * the visitor can edit. It is a config document, never a module.
 */
export const TSCONFIG_FILE_NAME = 'tsconfig.json';

export function isTsconfigFile(name: string): boolean {
	return name === TSCONFIG_FILE_NAME;
}

/** Entry default for new workspaces ("App.tsx"). */
export const DEFAULT_ENTRY_FILE = 'App.tsx';

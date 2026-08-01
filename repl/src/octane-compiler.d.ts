// Minimal typings for the octane compiler subpath the playground uses. The
// published octane package omits the compiler .d.ts files (only vite.d.ts
// ships); these mirror the runtime shapes the playground engine consumes.
declare module 'octane/compiler' {
	export interface CompilePosition {
		offset: number;
		line: number;
		column: number;
	}

	export interface CompileDiagnostic {
		code?: string;
		severity?: 'error' | 'warning';
		message: string;
		filename: string;
		start: CompilePosition;
		end?: CompilePosition;
	}

	export interface CompileTemplateOrigin {
		start: number;
		end: number;
		srcStart: number;
		srcEnd: number;
		kind?: string;
	}

	export interface CompileTemplate {
		name: string | null;
		ast: unknown;
		html: string;
		raw: string;
		origins: readonly CompileTemplateOrigin[];
	}

	export interface CompileInspect {
		ast: unknown;
		templates: CompileTemplate[];
		segments: unknown[];
		aliases?: unknown[];
	}

	export interface CompileResult {
		code: string;
		map: unknown;
		diagnostics: CompileDiagnostic[];
		inspect?: CompileInspect;
	}

	export interface CompileOptions {
		mode?: 'client' | 'server';
		dev?: boolean;
		hmr?: boolean | 'vite' | 'webpack';
		strong?: boolean;
		profile?: boolean;
		inspect?: boolean;
		root?: string;
		renderer?: unknown;
		rendererBoundaries?: unknown;
		rendererRegistry?: unknown;
		clientOnlyImports?: readonly unknown[];
	}

	export function compile(source: string, filename: string, options?: CompileOptions): CompileResult;
}

declare module 'octane/compiler/volar' {
	export interface VolarTypesInspection {
		code: string;
		segments: unknown[];
		sourceAst: unknown;
		generatedAst: unknown;
	}

	export function compileTypesInspection(
		source: string,
		filename: string,
		options?: unknown,
	): VolarTypesInspection;
}

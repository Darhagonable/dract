export interface PackageOptions {
	/** Working directory (default: process.cwd()) */
	cwd: string;
	/** Input directory relative to cwd (default: 'src') */
	input: string;
	/** Output directory relative to cwd (default: 'dist') */
	output: string;
	/** Generate .d.ts files (default: true) */
	types: boolean;
	/** Path to tsconfig.json (auto-detected if not set) */
	tsconfig?: string;
}

export interface PackageFile {
	/** Relative path from input dir (e.g. 'index.ts', 'createRouter.tsx') */
	name: string;
	/** Destination path relative to output dir */
	dest: string;
	/** Whether this file contains DarTsx syntax */
	isDartsx: boolean;
	/** Whether this is a .d.ts file */
	isDeclaration: boolean;
}

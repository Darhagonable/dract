/**
 * DarTsx Compiler — public entry point.
 *
 * Re-exports the single-file `compileModule` API and the cross-module `Project`.
 */
export { compileModule, type CompileModuleOptions, type ModuleOutput } from './module';
export { Project, type ProjectOptions, type ProjectHost } from './project';

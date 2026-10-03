/**
 * Phase 3 — Analyze
 *
 * Walks the OXC AST (already parsed) and builds metadata for the transform:
 * - Scope tree (via create_scopes)
 * - Component identification
 * - Binding kind upgrades (state/derived markers → binding.kind)
 * - Transform records on bindings (read/assign/update)
 * - Style block association
 * - Cross-file reactive import tracking
 * - Call-site analysis: reactive arg positions, signal-return consumption
 *   (`derived x = fn()`), and declaration-site upgrades (raw bindings,
 *   bind-prop destructuring)
 *
 * Does NOT build any JSX IR. The transform walks the OXC AST directly
 * with zimmerframe visitors.
 */
import type { ComponentMeta, PreprocessResult } from '../1-preprocess';
import { STATE_MARKER, DERIVED_MARKER } from '../1-preprocess';
import {
	Scope,
	ScopeRoot,
	create_scopes,
	type Binding,
	type SignalReturnKind,
	type SignalReturnClassification,
	type ReactiveImportInfo,
} from '../../scope';
import type { AstNode } from '../../builders';
import type {
	Program,
	Statement,
	Directive,
	Expression,
	Argument,
	FunctionBody,
	ParamPattern,
	Function as OxcFunction,
	VariableDeclaration,
	JSXElement,
	JSXFragment,
} from 'oxc-parser';

// ── Types ──────────────────────────────────────────────────────────

/** Runtime type guard: checks that a value is a span-bearing AST node */
function isAstNode(value: unknown): value is AstNode {
	return (
		value !== null &&
		typeof value === 'object' &&
		'type' in value &&
		typeof value.type === 'string' &&
		'start' in value &&
		'end' in value
	);
}

export type { SignalReturnKind } from '../../scope';

export interface StyleBlockIR {
	css: string;
	isGlobal: boolean;
	scopePath: number[];
	index: number;
}

/**
 * Shape of what a signal-returning function hands back:
 * - `'signal'` — the raw signal itself (`return name` where name is
 *   state/derived); signalKind records which, since deriveds are read-only.
 * - `'bag'` — an object literal of reactive shorthands; properties maps each
 *   key to its binding kind ('state' = propagating setter, 'derived' =
 *   getter + inert setter, 'plain' = ordinary value).
 */
export interface ComponentInfo {
	meta: ComponentMeta;
	/** The FunctionDeclaration (or ExportNamedDeclaration wrapping it) AST node */
	node: AstNode;
	/** The function's body AST node */
	bodyNode: FunctionBody | null;
	/** Per-component rename map (localName → externalName) */
	renamedParams: Record<string, string>;
	/** Local names that are bind props */
	bindParams: string[];
	/** Style blocks for this component */
	styleBlocks: StyleBlockIR[];
	/** Component's own scope (child of module scope, created by create_scopes) */
	scope: Scope;
}

export interface AnalysisResult {
	/** The OXC AST (unmodified, to be walked by transform) */
	ast: Program;
	/** Original source text */
	source: string;
	/** Module-level scope */
	scope: Scope;
	/** Scope root (for unique name generation) */
	root: ScopeRoot;
	/** Map from AST nodes to their scopes (for zimmerframe _ visitor) */
	scopes: Map<AstNode, Scope>;
	/** Component metadata keyed by AST node */
	components: Map<AstNode, ComponentInfo>;
	/** Set of component function names */
	componentNames: Set<string>;
	/** Style blocks keyed by component AST node */
	styles: Map<AstNode, StyleBlockIR[]>;
	/** Names of reactive exports (state + derived) for cross-file tracking */
	reactiveExports: string[];
	/**
	 * Cross-file reactive function calls detected at call sites.
	 * Maps import specifier → { exportedName → reactive param indices }.
	 */
	reactiveCalls: Record<string, Record<string, number[]>>;
	/**
	 * Maps callable function names to their reactive param indices.
	 * Used to suppress $.get() unwrapping on call arguments.
	 */
	reactiveCallTargets: Map<string, Set<number>>;
	/** Function nodes classified as signal-returning (return-position raw pass-through) */
	signalReturnFns: Set<AstNode>;
	/** Object-literal nodes classified as signal bags */
	signalBagNodes: Set<AstNode>;
	/** Exported signal-returning callables (for cross-file tracking) */
	reactiveReturnsMeta: Record<string, SignalReturnKind>;
	/** Call expressions bound by `derived x = fn()` — left raw by the transform */
	rawSignalCalls: Set<AstNode>;
	/** Imported signal-returning callables by local name */
	signalReturnShapes: Map<string, SignalReturnKind>;
	/** Import specifiers found in this module */
	importSpecifiers: string[];
	/** Preprocessor result (for downstream use) */
	preprocessed: PreprocessResult;
}

// ── Analyze ────────────────────────────────────────────────────────

export function analyze(
	ast: Program,
	source: string,
	meta: PreprocessResult,
	reactiveImports?: Record<string, ReactiveImportInfo>,
	reactiveCalls?: Record<string, number[]>,
): AnalysisResult {
	const componentNames = new Set(meta.components.map((c) => c.name));
	const stateSet = new Set(meta.stateVars);
	const derivedSet = new Set(meta.derivedVars);

	// 1. Build scope tree
	const root = new ScopeRoot();
	const { scope: moduleScope, scopes } = create_scopes(ast, source, root);

	// 2. Upgrade binding kinds based on markers
	upgradeBindingKinds(ast, scopes, stateSet, derivedSet, componentNames, meta);

	// 3. Mark cross-file reactive imports
	if (reactiveImports) {
		markCrossFileReactiveImports(ast, moduleScope, reactiveImports);
	}

	// 4. Identify components and associate metadata
	const components = new Map<AstNode, ComponentInfo>();
	const styles = new Map<AstNode, StyleBlockIR[]>();
	const reactiveExports: string[] = [];
	const importSpecifiers: string[] = [];

	/** Maps function names to ordered param name lists (for call-site analysis) */
	const functionParamMap = new Map<string, string[]>();
	/** Maps imported local names to their source specifier and exported name */
	const importSourceMap = new Map<string, { specifier: string; exportedName: string }>();

	/** Recursively find component function declarations at any nesting level */
	function findComponents(node: AstNode): void {
		const fn = extractFunctionDecl(node);
		if (fn && componentNames.has(fn.name)) {
			const compMeta = meta.components.find((c) => c.name === fn.name)!;
			const jsxRoot = findReturnJSXRoot(fn.node);
			const compStyleBlocks = (meta.styleBlocks || []).filter(
				(sb) => jsxRoot ? findJSXMarkerElement(jsxRoot, sb.markerName) !== null : false,
			);

			const fnNode = fn.node;
			const compScope = scopes.get(fnNode) || moduleScope;

			upgradeComponentParams(fnNode, compScope, meta.renamedParams[compMeta.name] || {}, meta.bindParams?.[compMeta.name] || []);

			const styleBlockIRs: StyleBlockIR[] = compStyleBlocks.map((sb, index) => ({
				css: sb.css,
				isGlobal: sb.isGlobal,
				scopePath: jsxRoot ? computeStyleBlockScopePath(jsxRoot, sb.markerName) : [],
				index,
			}));

			const info: ComponentInfo = {
				meta: compMeta,
				node,
				bodyNode: fn.body,
				renamedParams: meta.renamedParams[compMeta.name] || {},
				bindParams: meta.bindParams?.[compMeta.name] || [],
				styleBlocks: styleBlockIRs,
				scope: compScope,
			};

			components.set(node, info);
			styles.set(node, styleBlockIRs);
		}

		// Recurse into function bodies to find nested components
		if (fn && fn.body) {
			for (const stmt of fn.body.body) {
				findComponents(stmt);
			}
			return;
		}

		// Recurse into other nested structures (e.g. describe(() => { it(() => { component ... }) }))
		if (node.type === 'ExpressionStatement') {
			findComponents(node.expression);
		} else if (node.type === 'CallExpression') {
			for (const arg of node.arguments) {
				findComponents(arg);
			}
		} else if (node.type === 'ArrowFunctionExpression') {
			if (node.body.type === 'BlockStatement') {
				for (const stmt of node.body.body) {
					findComponents(stmt);
				}
			}
		} else if (node.type === 'FunctionExpression') {
			if (node.body) {
				for (const stmt of node.body.body) {
					findComponents(stmt);
				}
			}
		}
	}

	for (const node of ast.body) {
		// Collect import specifiers and source mappings
		if (node.type === 'ImportDeclaration') {
			const src = node.source.value;
			if (src && !src.startsWith('dartsx/internal')) {
				importSpecifiers.push(src);
			}
			if (src) {
				for (const spec of node.specifiers) {
					if (spec.type === 'ImportSpecifier') {
						const importedName = spec.imported.type === 'Identifier'
							? spec.imported.name
							: spec.imported.value;
						const localName = spec.local.name;
						importSourceMap.set(localName, { specifier: src, exportedName: importedName });
					}
				}
			}
			continue;
		}

		// Identify component function declarations (including nested)
		findComponents(node);

		// Collect function param maps for call-site analysis
		const fn = extractFunctionDecl(node);
		if (fn && !componentNames.has(fn.name)) {
			const paramNames = fn.params
				.map((p) => {
					if (p.type === 'Identifier') return p.name;
					if (p.type === 'RestElement') {
						return p.argument.type === 'Identifier' ? p.argument.name : undefined;
					}
					if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') {
						return p.left.name;
					}
					return undefined;
				})
				.filter((name): name is string => name !== undefined);
			functionParamMap.set(fn.name, paramNames);
		}

		// Track reactive exports
		if (node.type === 'ExportNamedDeclaration' || node.type === 'VariableDeclaration') {
			const varDecl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
			const exported = node.type === 'ExportNamedDeclaration';
			if (exported && varDecl?.type === 'VariableDeclaration') {
				for (const decl of varDecl.declarations) {
					if (decl.id.type !== 'Identifier') continue;
					const name = decl.id.name;
					if (!name) continue;
					const binding = moduleScope.get(name);
					if (binding && (binding.kind === 'state' || binding.kind === 'derived')) {
						binding.exported = true;
						reactiveExports.push(name);
					}
				}
			}
		}
	}

	// 5. Signal-return classification — runs BEFORE the call-site walk so
	//    bindings already carry their classification while usage is detected.
	const classified = classifySignalReturns(ast, moduleScope, scopes, componentNames);

	// 6. Unified call-site analysis: one walk collecting reactive ARG
	//    positions, signal-return consumption (`derived x = fn()` sites),
	//    and the declaration sites whose bindings get upgraded afterwards.
	const implicitReactiveParams = new Map<string, Set<string>>();
	const importedReactiveCalls: Record<string, Record<string, Set<number>>> = {};
	const signalCallSites: SignalCallSite[] = [];
	const bagAliasSites: BagAliasSite[] = [];

	walkCallSites(
		ast, source, moduleScope, scopes, stateSet, derivedSet,
		componentNames, functionParamMap, implicitReactiveParams,
		importSourceMap, importedReactiveCalls,
		signalCallSites, bagAliasSites,
	);

	// Second-pass: re-scan function bodies where params became reactive
	for (const node of ast.body) {
		const fn = extractFunctionDecl(node);
		if (!fn || componentNames.has(fn.name)) continue;

		const sameFileReactive = implicitReactiveParams.get(fn.name);
		const crossFileIndices = reactiveCalls?.[fn.name];
		if (!sameFileReactive && !crossFileIndices) continue;

		const paramNames = functionParamMap.get(fn.name) || [];
		const fnScope = scopes.get(fn.node) || moduleScope;

		// Upgrade reactive params in scope
		if (sameFileReactive) {
			for (const paramName of sameFileReactive) {
				const binding = fnScope.get(paramName);
				if (binding && binding.kind === 'normal') {
					binding.kind = 'prop'; // treat as reactive param
				}
			}
		}
		if (crossFileIndices) {
			for (const idx of crossFileIndices) {
				if (idx < paramNames.length) {
					const binding = fnScope.get(paramNames[idx]);
					if (binding && binding.kind === 'normal') {
						binding.kind = 'prop';
					}
				}
			}
		}

		// Re-walk for forwarded calls (signal-return collection is idempotent:
		// Sets dedupe, site upgrades are stable)
		const secondPassImportedCalls: Record<string, Record<string, Set<number>>> = {};
		walkCallSites(
			node, source, fnScope, scopes, stateSet, derivedSet,
			componentNames, functionParamMap, new Map(),
			importSourceMap, secondPassImportedCalls,
			signalCallSites, bagAliasSites,
		);
		for (const [specifier, fns] of Object.entries(secondPassImportedCalls)) {
			if (!importedReactiveCalls[specifier]) importedReactiveCalls[specifier] = {};
			for (const [fnName, idxSet] of Object.entries(fns)) {
				if (!importedReactiveCalls[specifier][fnName]) importedReactiveCalls[specifier][fnName] = new Set();
				for (const i of idxSet) importedReactiveCalls[specifier][fnName].add(i);
			}
		}
	}

	// Convert Set<number> to number[] for result
	const reactiveCallsResult: Record<string, Record<string, number[]>> = {};
	for (const [specifier, fns] of Object.entries(importedReactiveCalls)) {
		reactiveCallsResult[specifier] = {};
		for (const [fnName, indices] of Object.entries(fns)) {
			reactiveCallsResult[specifier][fnName] = [...indices];
		}
	}

	// Build reactiveCallTargets
	const reactiveCallTargets = new Map<string, Set<number>>();

	// Local functions with reactive params
	for (const [fnName, reactiveParamNames] of implicitReactiveParams) {
		const paramNames = functionParamMap.get(fnName) || [];
		const indices = new Set<number>();
		for (const rp of reactiveParamNames) {
			const idx = paramNames.indexOf(rp);
			if (idx >= 0) indices.add(idx);
		}
		if (indices.size > 0) reactiveCallTargets.set(fnName, indices);
	}

	// Imported functions with detected reactive call positions
	for (const [_specifier, fns] of Object.entries(reactiveCallsResult)) {
		for (const [fnName, indices] of Object.entries(fns)) {
			for (const [localName, info] of importSourceMap) {
				if (info.exportedName === fnName) {
					const existing = reactiveCallTargets.get(localName) || new Set();
					for (const idx of indices) existing.add(idx);
					reactiveCallTargets.set(localName, existing);
				}
			}
		}
	}

	// Cross-file reactive param info from the project registry
	if (reactiveCalls) {
		for (const [fnName, indices] of Object.entries(reactiveCalls)) {
			const existing = reactiveCallTargets.get(fnName) || new Set();
			for (const idx of indices) existing.add(idx);
			reactiveCallTargets.set(fnName, existing);
		}
	}

	// 7. Signal-return upgrades. Classified functions hand their signals
	// (or signal bags) to consumers raw, like reactive imports — but only
	// when raw consumption is REACHABLE: the callable is exported, or a
	// same-file `derived x = fn()` consumer exists (each site activates its
	// own callee). Module-local unconsumed callables keep value semantics
	// (`return $.get(x)`), so ordinary helper functions compile exactly as
	// they would without signal returns. Active callables' callers pick the
	// semantics per site: `derived x = fn()` binds the signal raw, any other
	// position snapshots the value with $.get (the transform's CallExpression
	// wrap).
	const consumedFnNodes = new Set<AstNode>();
	for (const site of signalCallSites) {
		if (site.calleeBinding?.signalReturn) consumedFnNodes.add(site.calleeBinding.signalReturn.fnNode);
	}

	const signalReturnFns = new Set<AstNode>();
	const signalBagNodes = new Set<AstNode>();
	const reactiveReturnsMeta: Record<string, SignalReturnKind> = {};
	for (const { name, binding, entry, exported } of classified.entries) {
		if (!exported && !consumedFnNodes.has(entry.fnNode)) continue;
		binding.signalReturnActive = true;
		signalReturnFns.add(entry.fnNode);
		for (const bag of entry.bags) signalBagNodes.add(bag);
		if (exported) reactiveReturnsMeta[name] = entry.info;
	}
	// Imported signal-returning callables (cross-file registry), by local name
	const importedShapes = new Map<string, SignalReturnKind>();
	if (reactiveImports) {
		for (const [localName, info] of importSourceMap.entries()) {
			const imported = reactiveImports[info.specifier]?.returns?.[info.exportedName];
			if (imported) importedShapes.set(localName, imported);
		}
	}
	upgradeSignalCallSites(signalCallSites, bagAliasSites, importedShapes);
	// Call expressions bound by `derived` — the transform leaves these raw
	const rawSignalCalls = new Set<AstNode>();
	for (const site of signalCallSites) {
		const init = (site.decl as { init?: AstNode }).init;
		if (init?.type === 'CallExpression') rawSignalCalls.add(init);
	}

	return {
		ast,
		source,
		scope: moduleScope,
		root,
		scopes,
		components,
		componentNames,
		styles,
		reactiveExports,
		reactiveCalls: reactiveCallsResult,
		reactiveCallTargets,
		signalReturnFns,
		signalBagNodes,
		reactiveReturnsMeta,
		/** Call expressions bound by `derived x = fn()` — left raw by the transform */
		rawSignalCalls,
		/** Imported signal-returning callables by local name */
		signalReturnShapes: importedShapes,
		importSpecifiers,
		preprocessed: meta,
	};
}

// ── Binding Kind Upgrades ──────────────────────────────────────────

/**
 * Walk the AST and upgrade binding kinds from 'normal' to 'state'/'derived'
 * based on $$s/$$d sibling-declarator markers emitted by preprocess.
 *
 * Preprocess emits `let $$s = 0, name = expr` for state and
 * `const $$d = 0, name = expr` for derived. We detect the marker
 * declarator and upgrade the next sibling's binding.
 */
function upgradeBindingKinds(
	ast: Program,
	scopes: Map<AstNode, Scope>,
	stateSet: Set<string>,
	derivedSet: Set<string>,
	componentNames: Set<string>,
	meta: PreprocessResult,
): void {
	function upgradeMarkedDeclarations(varDecl: VariableDeclaration, scope: Scope, exported = false): void {
		let prevName: string | null = null;
		for (const decl of varDecl.declarations) {
			if (decl.id.type === 'Identifier') {
				const name = decl.id.name;

				// Skip marker declarators themselves, but remember their name
				if (name.startsWith(STATE_MARKER) || name.startsWith(DERIVED_MARKER)) {
					prevName = name;
					continue;
				}

				const binding = scope.get(name);
				if (!binding) continue;

				if (prevName?.startsWith(STATE_MARKER)) {
					binding.kind = 'state';
					binding.exported = exported;
					if (decl.init && isProxyInit(decl.init, scope)) binding.proxy = true;
				}
				if (prevName?.startsWith(DERIVED_MARKER)) {
					binding.kind = 'derived';
					binding.exported = exported;
				}
			} else if ((decl.id.type === 'ObjectPattern' || decl.id.type === 'ArrayPattern') && prevName?.startsWith(DERIVED_MARKER)) {
				// Derived destructuring: mark all identifiers in the pattern as derived
				upgradePatternBindings(decl.id, scope, 'derived', exported);
			}
			// Reset prevName after processing a non-marker declarator
			if (decl.id.type !== 'Identifier' || !(decl.id.name.startsWith(STATE_MARKER) || decl.id.name.startsWith(DERIVED_MARKER))) {
				prevName = null;
			}
		}
	}

	function upgradePatternBindings(node: any, scope: Scope, kind: 'state' | 'derived', exported: boolean): void {
		if (!node) return;
		if (node.type === 'Identifier') {
			const binding = scope.get(node.name);
			if (binding) { binding.kind = kind; binding.exported = exported; }
			return;
		}
		if (node.type === 'ObjectPattern') {
			for (const prop of node.properties || []) {
				if (prop?.type === 'RestElement') upgradePatternBindings(prop.argument, scope, kind, exported);
				else if (prop) upgradePatternBindings(prop.value, scope, kind, exported);
			}
			return;
		}
		if (node.type === 'ArrayPattern') {
			for (const elem of node.elements || []) {
				if (!elem) continue;
				if (elem.type === 'RestElement') upgradePatternBindings(elem.argument, scope, kind, exported);
				else upgradePatternBindings(elem, scope, kind, exported);
			}
			return;
		}
		if (node.type === 'AssignmentPattern') {
			upgradePatternBindings(node.left, scope, kind, exported);
			return;
		}
	}

	function visitStmts(stmts: ReadonlyArray<Directive | Statement>, scope: Scope): void {
		for (const stmt of stmts) {
			// Unwrap exports — `export const Ctx = createContext(() => { state x = 0 })`
			// must upgrade the factory's markers like the unexported form does.
			if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) {
				visitStmts([stmt.declaration], scope);
				continue;
			}

			if (stmt.type === 'VariableDeclaration') {
				upgradeMarkedDeclarations(stmt, scope);
			}

			// Recurse into function bodies
			if (stmt.type === 'FunctionDeclaration' && stmt.body) {
				const fnScope = scopes.get(stmt) || scope;
				visitStmts(stmt.body.body, fnScope);
			}

			// Recurse into arrow/function expression bodies in variable declarations
			if (stmt.type === 'VariableDeclaration') {
				for (const decl of stmt.declarations) {
					const init = decl.init;
					if (init && init.type === 'ArrowFunctionExpression') {
						const fnScope = scopes.get(init) || scope;
						if (init.body.type === 'BlockStatement') {
							visitStmts(init.body.body, fnScope);
						}
					} else if (init && init.type === 'FunctionExpression') {
						const fnScope = scopes.get(init) || scope;
						if (init.body) {
							visitStmts(init.body.body, fnScope);
						}
					}
					// Also recurse into call expression arguments (e.g., createContext(() => { state x = 0; }))
					if (init && init.type === 'CallExpression') {
						visitExpression(init, scope);
					}
				}
			}

			// Recurse into statement-level call arguments (e.g. test wrappers:
			// `it('...', () => { const Ctx = createContext(() => { state x = 0 }) })`)
			if (stmt.type === 'ExpressionStatement') {
				visitExpression(stmt.expression, scope);
			}

			// Recurse into blocks, loops, etc.
			if (stmt.type === 'BlockStatement') {
				const blockScope = scopes.get(stmt) || scope;
				visitStmts(stmt.body, blockScope);
			}

			// Recurse into if/else
			if (stmt.type === 'IfStatement') {
				if (stmt.consequent.type === 'BlockStatement') {
					const blockScope = scopes.get(stmt.consequent) || scope;
					visitStmts(stmt.consequent.body, blockScope);
				}
				if (stmt.alternate) {
					if (stmt.alternate.type === 'BlockStatement') {
						const blockScope = scopes.get(stmt.alternate) || scope;
						visitStmts(stmt.alternate.body, blockScope);
					} else {
						visitStmts([stmt.alternate], scope);
					}
				}
			}

			// Recurse into loops
			if (stmt.type === 'ForStatement' || stmt.type === 'ForInStatement' || stmt.type === 'ForOfStatement' || stmt.type === 'WhileStatement' || stmt.type === 'DoWhileStatement') {
				if (stmt.body.type === 'BlockStatement') {
					const blockScope = scopes.get(stmt.body) || scope;
					visitStmts(stmt.body.body, blockScope);
				}
			}

			// Recurse into switch cases
			if (stmt.type === 'SwitchStatement') {
				for (const c of stmt.cases) {
					visitStmts(c.consequent, scope);
				}
			}

			// Recurse into try/catch/finally
			if (stmt.type === 'TryStatement') {
				if (stmt.block) {
					const blockScope = scopes.get(stmt.block) || scope;
					visitStmts(stmt.block.body, blockScope);
				}
				if (stmt.handler?.body) {
					const blockScope = scopes.get(stmt.handler.body) || scope;
					visitStmts(stmt.handler.body.body, blockScope);
				}
				if (stmt.finalizer) {
					const blockScope = scopes.get(stmt.finalizer) || scope;
					visitStmts(stmt.finalizer.body, blockScope);
				}
			}

			// Export wrapped function declarations
			if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'FunctionDeclaration') {
				const fn = stmt.declaration;
				const fnScope = scopes.get(fn) || scope;
				if (fn.body) {
					visitStmts(fn.body.body, fnScope);
				}
			}
			if (stmt.type === 'ExportDefaultDeclaration' && stmt.declaration?.type === 'FunctionDeclaration') {
				const fn = stmt.declaration;
				const fnScope = scopes.get(fn) || scope;
				if (fn.body) {
					visitStmts(fn.body.body, fnScope);
				}
			}

			// Export wrapped variable declarations
			if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration') {
				upgradeMarkedDeclarations(stmt.declaration, scope, true);
			}

			// Recurse into expression statements (e.g., describe(() => { ... }))
			if (stmt.type === 'ExpressionStatement') {
				visitExpression(stmt.expression, scope);
			}
		}
	}

	function visitExpression(expr: Expression, scope: Scope): void {
		if (expr.type === 'CallExpression') {
			for (const arg of expr.arguments) {
				if (arg.type !== 'SpreadElement') {
					visitExpression(arg, scope);
				}
			}
		} else if (expr.type === 'ArrowFunctionExpression') {
			const fnScope = scopes.get(expr) || scope;
			if (expr.body.type === 'BlockStatement') {
				visitStmts(expr.body.body, fnScope);
			}
		} else if (expr.type === 'FunctionExpression') {
			const fnScope = scopes.get(expr) || scope;
			if (expr.body) {
				visitStmts(expr.body.body, fnScope);
			}
		}
	}

	const moduleScope = scopes.get(ast) || new Scope(new ScopeRoot());
	visitStmts(ast.body, moduleScope);
}

/**
 * Mark cross-file reactive imports in the module scope.
 */
function markCrossFileReactiveImports(
	ast: Program,
	moduleScope: Scope,
	reactiveImports: Record<string, ReactiveImportInfo>,
): void {
	for (const node of ast.body) {
		if (node.type !== 'ImportDeclaration') continue;
		const specifier = node.source.value;
		if (!specifier) continue;
		const reactiveNames = reactiveImports[specifier]?.bindings;
		if (!reactiveNames) continue;
		const reactiveSet = new Set(reactiveNames);
		for (const spec of node.specifiers) {
			if (spec.type === 'ImportSpecifier') {
				const importedName = spec.imported.type === 'Identifier'
					? spec.imported.name
					: spec.imported.value;
				if (reactiveSet.has(importedName)) {
					const localName = spec.local.name;
					const binding = moduleScope.get(localName);
					if (binding) {
						binding.kind = 'state';
					}
				}
			}
		}
	}
}

/**
 * Upgrade component parameter bindings to param/bind-prop/rest-prop kinds.
 */
function upgradeComponentParams(
	fnNode: OxcFunction,
	compScope: Scope,
	renamedParams: Record<string, string>,
	bindParamNames: string[],
): void {
	const bindSet = new Set(bindParamNames);

	// New format: first param is ObjectPattern ({x, y, ...rest})
	const firstParam = fnNode.params[0];
	if (firstParam && firstParam.type === 'ObjectPattern') {
		for (const prop of firstParam.properties) {
			if (prop.type === 'RestElement') {
				if (prop.argument.type === 'Identifier') {
					const binding = compScope.get(prop.argument.name);
					if (binding) binding.kind = 'rest-prop';
				}
				continue;
			}
			// Property — get local name from value (Identifier or AssignmentPattern)
			let localName: string | undefined;
			if (prop.value.type === 'Identifier') {
				localName = prop.value.name;
			} else if (prop.value.type === 'AssignmentPattern' && prop.value.left.type === 'Identifier') {
				localName = prop.value.left.name;
			}
			if (!localName) continue;

			if (bindSet.has(localName)) {
				compScope.declare(localName, 'bind-prop', 'let');
			} else {
				const binding = compScope.get(localName);
				if (binding) binding.kind = 'prop';
			}
		}
	}
}

// ── Call-site Analysis ─────────────────────────────────────────────

/** A `derived … = fn()` declaration site recorded by the call-site walk */
interface SignalCallSite {
	/** The VariableDeclarator being initialized */
	decl: AstNode;
	/** The scope the declaration lives in */
	scope: Scope;
	/** The callee's local name */
	calleeName: string;
	/** The callee's binding (null for imports) */
	calleeBinding: Binding | null;
}

/** A `derived alias = bagHolder` declaration site recorded by the call-site walk */
interface BagAliasSite {
	/** The alias binding's name */
	idName: string;
	/** The scope the declaration lives in */
	scope: Scope;
	/** The bag-holding source binding */
	source: Binding;
}

/**
 * Walk AST looking for call expressions to detect which function params
 * receive reactive variables as arguments — and, in the same pass, which
 * functions are consumed as signal returns (`derived x = fn()`): local
 * candidates mark their callable binding consumed, imported ones are
 * reported per specifier, and the declaration sites are recorded for the
 * upgrade pass (see upgradeSignalCallSites).
 */
function walkCallSites(
	ast: AstNode,
	source: string,
	moduleScope: Scope,
	scopes: Map<AstNode, Scope>,
	stateSet: Set<string>,
	derivedSet: Set<string>,
	componentNames: Set<string>,
	functionParamMap: Map<string, string[]>,
	localResult: Map<string, Set<string>>,
	importSourceMap: Map<string, { specifier: string; exportedName: string }>,
	importedResult: Record<string, Record<string, Set<number>>>,
	signalCallSites: SignalCallSite[],
	bagAliasSites: BagAliasSite[],
): void {
	let activeScope: Scope = moduleScope;

	function isReactiveArg(arg: Argument): boolean {
		if (arg.type === 'Identifier') {
			const binding = activeScope.get(arg.name);
			return binding ? binding.reactive : false;
		}
		if (arg.type === 'MemberExpression') return isReactiveArg(arg.object);
		if (arg.type === 'ArrayExpression') {
			return arg.elements.some((el) => el !== null && isReactiveArg(el));
		}
		return false;
	}

	function visit(node: AstNode): void {
		// Switch scope on component function entry
		if (node.type === 'FunctionDeclaration' && node.id && componentNames.has(node.id.name)) {
			const prevScope = activeScope;
			activeScope = scopes.get(node) || activeScope;
			forEachChild(node, visit);
			activeScope = prevScope;
			return;
		}

		// Switch scope on any function entry
		if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
			const fnScope = scopes.get(node);
			if (fnScope) {
				const prevScope = activeScope;
				activeScope = fnScope;
				forEachChild(node, visit);
				activeScope = prevScope;
				return;
			}
		}

		// `derived x = fn()` declarations: the call binds the returned
		// signal raw (upgraded after the walk — imported shapes may only be
		// known then). Bag alias candidates (`derived c3 = ctx`) likewise.
		// Only `derived` declarations opt in — plain `const x = fn()` gets a
		// $.get value snapshot (the transform's CallExpression wrap).
		if (node.type === 'VariableDeclaration') {
			let afterDerivedMarker = false;
			for (const decl of node.declarations) {
				const id = decl.id as AstNode;
				if (id.type === 'Identifier' && (id as { name: string }).name.startsWith(DERIVED_MARKER)) {
					afterDerivedMarker = true;
					continue;
				}
				if (afterDerivedMarker && decl.init) {
					const init = decl.init;
					if (init.type === 'Identifier') {
						const source = activeScope.get(init.name);
						if (source && id.type === 'Identifier') {
							bagAliasSites.push({ idName: id.name, scope: activeScope, source });
						}
					} else if (init.type === 'CallExpression' && init.callee.type === 'Identifier') {
						signalCallSites.push({
							decl,
							scope: activeScope,
							calleeName: init.callee.name,
							calleeBinding: activeScope.get(init.callee.name) ?? null,
						});
					}
				}
				afterDerivedMarker = false;
			}
		}

		if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
			const fnName = node.callee.name;
			const args = node.arguments;

			// Check calls to local functions
			const paramNames = functionParamMap.get(fnName);
			if (paramNames) {
				for (let i = 0; i < args.length && i < paramNames.length; i++) {
					if (isReactiveArg(args[i])) {
						if (!localResult.has(fnName)) localResult.set(fnName, new Set());
						localResult.get(fnName)!.add(paramNames[i]);
					}
				}
			}

			// Check calls to imported functions
			const importInfo = importSourceMap.get(fnName);
			if (importInfo) {
				for (let i = 0; i < args.length; i++) {
					if (isReactiveArg(args[i])) {
						if (!importedResult[importInfo.specifier]) importedResult[importInfo.specifier] = {};
						if (!importedResult[importInfo.specifier][importInfo.exportedName]) {
							importedResult[importInfo.specifier][importInfo.exportedName] = new Set();
						}
						importedResult[importInfo.specifier][importInfo.exportedName].add(i);
					}
				}
			}
		}

		forEachChild(node, visit);
	}

	visit(ast);
}

/**
 * Upgrade the recorded `derived x = fn()` sites: bind the signal (or bag)
 * raw — like a reactive import — marking state-kind signals writable and
 * destructured state-kind bag properties as bind-props (setter-delegated).
 * Local callables resolve through their binding; imported ones arrive with
 * their return shape from the project registry.
 */
function upgradeSignalCallSites(
	sites: SignalCallSite[],
	aliasSites: BagAliasSite[],
	importedShapes: Map<string, SignalReturnKind>,
): void {
	for (const site of sites) {
		let info: SignalReturnKind | null;
		if (site.calleeBinding?.signalReturn) {
			info = site.calleeBinding.signalReturn.info;
		} else {
			info = importedShapes.get(site.calleeName) ?? null;
		}
		if (!info) continue;

		const decl = site.decl as { id?: AstNode };
		const id = decl.id;
		if (!id) continue;

		if (id.type === 'Identifier') {
			const binding = site.scope.get(id.name);
			if (!binding) continue;
			binding.signalCall = true;
			if (info.type === 'bag') binding.signalBagHolder = true; // aliases must not $.derived-wrap
			if (info.type === 'signal' && info.signalKind === 'state') {
				binding.kind = 'state'; // writable: `x = v` propagates
			}
		} else if (id.type === 'ObjectPattern' && info.type === 'bag') {
			for (const prop of id.properties) {
				if (prop.type !== 'Property' || prop.key.type !== 'Identifier' || prop.computed) continue;
				if (prop.value.type !== 'Identifier') continue;
				if (info.properties[prop.key.name] === 'state') {
					const binding = site.scope.get(prop.value.name);
					if (binding) {
						binding.kind = 'bind-prop'; // writable, setter-delegated
						binding.signalCall = true;
					}
				}
			}
		}
	}

	// Bag aliases run after the call-site upgrades: their source's holder
	// flag (set directly or by a call-site upgrade above) propagates so the
	// alias binds raw too — $.derived-wrapping would flatten the accessors.
	for (const site of aliasSites) {
		if (!site.source.signalBagHolder) continue;
		const binding = site.scope.get(site.idName);
		if (binding) binding.signalBagHolder = true;
	}
}

// ── Helpers ────────────────────────────────────────────────────────

interface FnInfo {
	name: string;
	node: OxcFunction;
	params: ParamPattern[];
	body: FunctionBody | null;
}

function extractFunctionDecl(node: AstNode): FnInfo | null {
	if (node.type === 'FunctionDeclaration' && node.id) {
		return { name: node.id.name, node, params: node.params, body: node.body };
	}
	if (node.type === 'ExportDefaultDeclaration' && node.declaration?.type === 'FunctionDeclaration') {
		const fn = node.declaration;
		return { name: fn.id?.name || 'default', node: fn, params: fn.params, body: fn.body };
	}
	if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration') {
		const fn = node.declaration;
		if (!fn.id) return null;
		return { name: fn.id.name, node: fn, params: fn.params, body: fn.body };
	}
	return null;
}

/**
 * Detect whether a state initializer will produce a proxy at runtime.
 * Known non-proxyable types return false; identifiers are resolved recursively
 * through their bindings when possible (like Svelte's should_proxy).
 */
function isProxyInit(node: Expression, scope: Scope | null): boolean {
	switch (node.type) {
		case 'Literal':
		case 'TemplateLiteral':
		case 'ArrowFunctionExpression':
		case 'FunctionExpression':
		case 'UnaryExpression':
		case 'BinaryExpression':
		case 'LogicalExpression':
		case 'ConditionalExpression':
		case 'SequenceExpression':
		case 'TaggedTemplateExpression':
		case 'MemberExpression':
			return false;
		case 'Identifier':
			if (node.name === 'undefined') return false;
			if (scope) {
				const binding = scope.get(node.name);
				if (binding && !binding.reassigned && binding.initial) {
					return isProxyInit(binding.initial as Expression, null);
				}
			}
			return false;
		default:
			return true;
	}
}

/**
 * Find the JSX root in a component's return statement.
 */
function findReturnJSXRoot(fnNode: OxcFunction): JSXElement | JSXFragment | null {
	if (!fnNode.body) return null;
	for (const stmt of fnNode.body.body) {
		if (stmt.type === 'ReturnStatement' && stmt.argument) {
			let node: Expression = stmt.argument;
			while (node.type === 'ParenthesizedExpression') node = node.expression;
			if (node.type === 'JSXElement' || node.type === 'JSXFragment') return node;
		}
	}
	return null;
}

/** Get the tag name of a JSXElement if it has a simple JSXIdentifier name */
function getJSXTagName(node: JSXElement): string | null {
	const name = node.openingElement.name;
	return name.type === 'JSXIdentifier' ? name.name : null;
}

/**
 * Find a JSX marker element by name in a JSX tree.
 * Returns the element node if found, null otherwise.
 */
function findJSXMarkerElement(node: JSXElement | JSXFragment, markerName: string): JSXElement | null {
	if (node.type === 'JSXElement' && getJSXTagName(node) === markerName) {
		return node;
	}
	for (const child of node.children) {
		if (child.type === 'JSXElement') {
			const found = findJSXMarkerElement(child, markerName);
			if (found) return found;
		} else if (child.type === 'JSXFragment') {
			const found = findJSXMarkerElement(child, markerName);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Compute the path of element indices from the root JSX node to the
 * JSXElement that directly contains a style marker element.
 */
function computeStyleBlockScopePath(rootNode: JSXElement | JSXFragment, markerName: string): number[] {
	const path: number[] = [];

	function walk(node: JSXElement | JSXFragment): boolean {
		let elementIdx = 0;
		for (const child of node.children) {
			if (child.type === 'JSXElement') {
				if (getJSXTagName(child) === markerName) return true;
				if (findJSXMarkerElement(child, markerName)) {
					path.push(elementIdx);
					walk(child);
					return true;
				}
				elementIdx++;
			}
		}
		return false;
	}

	walk(rootNode);
	return path;
}

/** Known AST fields that contain child nodes */
const AST_CHILD_FIELDS = [
	'body', 'declarations', 'declaration', 'init', 'test', 'consequent',
	'alternate', 'expression', 'expressions', 'left', 'right', 'object',
	'property', 'callee', 'arguments', 'elements', 'properties', 'value',
	'argument', 'params', 'items', 'statements', 'block', 'handler',
	'finalizer', 'cases', 'discriminant', 'update', 'children',
	'openingElement', 'closingElement', 'attributes', 'specifiers',
	'source', 'key', 'id', 'label', 'tag', 'quasi', 'quasis',
];

const AST_CHILD_FIELD_SET = new Set(AST_CHILD_FIELDS);

/** Visit all AST child nodes of a given node */
// ── Signal-return classification ───────────────────────────────────

/** Collect ReturnStatements within a function, not descending into nested functions */
function collectReturns(node: AstNode, out: AstNode[]): void {
	forEachChild(node, (child) => {
		if (child.type === 'FunctionDeclaration' || child.type === 'FunctionExpression' || child.type === 'ArrowFunctionExpression') return;
		if (child.type === 'ReturnStatement') out.push(child);
		collectReturns(child, out);
	});
}

/** Classify an object literal as a signal bag; null when it holds no reactive shorthands */
function classifyBag(obj: AstNode, scope: Scope, bags: AstNode[]): SignalReturnKind | null {
	const properties: Record<string, 'state' | 'derived' | 'plain'> = {};
	let hasReactive = false;
	for (const prop of (obj as { properties: AstNode[] }).properties ?? []) {
		if (prop.type === 'SpreadElement') return null;
		if (prop.type !== 'Property') continue;
		const key = prop.key;
		if (key.type !== 'Identifier' || prop.computed) continue;
		let kind: 'state' | 'derived' | 'plain' = 'plain';
		if (prop.shorthand && (prop.value as AstNode).type === 'Identifier') {
			const binding = scope.get((prop.value as { name: string }).name);
			if (binding?.kind === 'state') kind = 'state';
			else if (binding?.kind === 'derived') kind = 'derived';
		}
		properties[key.name] = kind;
		if (kind !== 'plain') hasReactive = true;
	}
	if (!hasReactive) return null;
	bags.push(obj);
	return { type: 'bag', properties };
}

/** Classify a return expression: bare reactive binding, or a bag via its binding's initializer */
function classifyReturnExpr(arg: AstNode | null | undefined, scope: Scope, bags: AstNode[]): SignalReturnKind | null {
	if (!arg) return null;
	if (arg.type === 'ObjectExpression') return classifyBag(arg, scope, bags);
	if (arg.type === 'Identifier') {
		const binding = scope.get(arg.name);
		if (!binding) return null;
		// Bag check FIRST — `derived ctx = {name, length}; return ctx` holds a
		// derived-kind binding but returns a bag, not a bare signal.
		if (binding.initial && binding.initial.type === 'ObjectExpression') {
			const bag = classifyBag(binding.initial, scope, bags);
			if (bag) {
				// Returning a derived-held bag must pass the bag VALUE out
				// ($.get at return position), not the signal — mark it.
				if (binding.kind === 'derived') binding.signalBagHolder = true;
				return bag;
			}
			// Non-reactive object initializers fall through to the kind check
			// below only for state/derived bindings; plain bindings bail.
		}
		if (binding.kind === 'state' || binding.kind === 'derived') {
			return { type: 'signal', signalKind: binding.kind };
		}
	}
	return null;
}

function mergeSignalReturn(a: SignalReturnKind | null, b: SignalReturnKind | null): SignalReturnKind | null {
	if (!a) return b;
	if (!b) return null; // some return path is not signal-shaped → disqualified
	if (a.type !== b.type) return null;
	if (a.type === 'signal' && b.type === 'signal' && a.signalKind !== b.signalKind) return null;
	if (a.type === 'bag' && b.type === 'bag') {
		for (const [key, kind] of Object.entries(b.properties)) {
			const existing = a.properties[key];
			if (existing === undefined) a.properties[key] = kind;
			else if (existing !== kind) a.properties[key] = 'derived';
		}
	}
	return a;
}

/** Classify one function node; null when not signal-returning */
function classifyFnNode(fnNode: AstNode, scope: Scope, bags: AstNode[]): SignalReturnKind | null {
	const body = (fnNode as { body?: AstNode }).body;
	if (!body || body.type !== 'BlockStatement') return null;
	const returns: AstNode[] = [];
	collectReturns(body, returns);
	if (returns.length === 0) return null;
	let result: SignalReturnKind | null = null;
	for (const ret of returns) {
		const info = classifyReturnExpr((ret as { argument?: AstNode }).argument, scope, bags);
		result = mergeSignalReturn(result, info);
		if (result === null) return null;
	}
	return result;
}

/**
 * Walk the module and collect signal-return candidates, attaching the
 * classification to the callable's BINDING (scope-aware, so same-named
 * bindings in sibling scopes classify independently):
 * - function declarations / const-bound function expressions whose every
 *   return is a bare reactive binding or a reactive-shorthand object
 * - `createContext(<candidate factory>)` — the const receiving it becomes
 *   a signal-returning callable (its accessor hands the signals back)
 *
 * Candidates are NOT yet signal-returning — a consumer must opt in with
 * `derived x = fn()` first (see walkCallSites / upgradeSignalCallSites).
 */
function classifySignalReturns(
	ast: Program,
	moduleScope: Scope,
	scopes: Map<AstNode, Scope>,
	componentNames: Set<string>,
): {
	entries: Array<{ name: string; binding: Binding; entry: SignalReturnClassification; exported: boolean }>;
} {
	const entries: Array<{ name: string; binding: Binding; entry: SignalReturnClassification; exported: boolean }> = [];
	let activeScope: Scope = moduleScope;

	function isComponentFn(node: AstNode): boolean {
		return node.type === 'FunctionDeclaration' &&
			(node as { id?: { name?: string } }).id != null &&
			componentNames.has((node as { id: { name: string } }).id.name);
	}

	function declare(name: string, fnNode: AstNode, isExported: boolean): void {
		// Resolve the callable's binding where it is DECLARED (activeScope),
		// but classify returns against the function's own scope — its state
		// and derived bindings live there.
		const binding = activeScope.get(name);
		if (!binding || binding.signalReturn) return;
		const fnScope = scopes.get(fnNode) || activeScope;
		const bags: AstNode[] = [];
		const info = classifyFnNode(fnNode, fnScope, bags);
		if (!info) return;
		const entry: SignalReturnClassification = { info, fnNode, bags };
		binding.signalReturn = entry;
		entries.push({ name, binding, entry, exported: isExported });
	}

	function visit(node: AstNode, isExported: boolean): void {
		// Unwrap exports so the wrapped declaration is processed directly
		if (node.type === 'ExportNamedDeclaration' && node.declaration) {
			visit(node.declaration, true);
			return;
		}

		// Enter function scopes for correct binding resolution — but declare
		// first: the function's OWN name binding lives in the enclosing scope.
		if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
			if (node.type === 'FunctionDeclaration' && !isComponentFn(node)) {
				const fname = (node as { id?: { name?: string } }).id?.name;
				if (fname) declare(fname, node, isExported);
			}
			const fnScope = scopes.get(node);
			if (fnScope && fnScope !== activeScope) {
				const prev = activeScope;
				activeScope = fnScope;
				forEachChild(node, (child) => visit(child, false));
				activeScope = prev;
				return;
			}
		}

		// const X = <fn expr>  |  const X = createContext(<fn>)
		if (node.type === 'VariableDeclaration') {
			for (const decl of node.declarations) {
				if (decl.id.type !== 'Identifier' || !decl.init) continue;
				const name = decl.id.name;
				const init = decl.init;
				if (init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression') {
					if (!isComponentFn(init)) declare(name, init, isExported);
				} else if (init.type === 'CallExpression' && init.callee.type === 'Identifier' && init.callee.name === 'createContext') {
					const factory = init.arguments[0];
					if (factory && (factory.type === 'FunctionExpression' || factory.type === 'ArrowFunctionExpression')) {
						declare(name, factory, isExported);
					}
				}
			}
		}

		forEachChild(node, (child) => visit(child, false));
	}

	visit(ast as unknown as AstNode, false);
	return { entries };
}


function forEachChild(node: AstNode, fn: (child: AstNode) => void): void {
	for (const [key, value] of Object.entries(node)) {
		if (!AST_CHILD_FIELD_SET.has(key)) continue;
		if (value == null) continue;
		if (Array.isArray(value)) {
			for (const item of value) {
				if (isAstNode(item)) fn(item);
			}
		} else if (isAstNode(value)) {
			fn(value);
		}
	}
}

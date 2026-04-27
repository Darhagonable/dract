/**
 * Scope tree for the DarTsx compiler.
 *
 * Built during Phase 2 (analyze) via `create_scopes()` and consumed by
 * Phase 3 (transform) via zimmerframe's visitor state.
 *
 * Architecture follows Svelte/Ripple: each AST node that introduces a scope
 * is mapped in `scopes: Map<Node, Scope>`. The `_` universal visitor switches
 * `state.scope` as the walk descends.
 */

import type { AstNode } from './builders';
import { walk, type Context } from 'zimmerframe';
import type {
	Program,
	ParamPattern,
	BindingPattern,
	BindingRestElement,
	VariableDeclarationKind,
} from 'oxc-parser';

// ── Types ──────────────────────────────────────────────────────────

export type BindingKind =
	| 'normal'      // regular variable, import, or function (use declaration_kind to distinguish)
	| 'state'       // `state x = ...` — signal, needs $.get()/$.set()
	| 'derived'     // `derived x = ...` — derived signal, needs $.get()
	| 'prop'        // component prop
	| 'bind-prop'   // bindable component prop
	| 'rest-prop';  // ...rest component prop

export type DeclarationKind =
	| 'var' | 'let' | 'const'
	| 'function' | 'param' | 'rest_param'
	| 'import' | 'component';

// ── ScopeRoot ──────────────────────────────────────────────────────

/**
 * Global scope root shared across all scopes.
 * Tracks all declared names to support unique name generation.
 */
export class ScopeRoot {
	conflicts: Set<string> = new Set();

	/** Generate a unique name that doesn't conflict with any declaration. */
	unique(preferred: string): string {
		let base = preferred.replace(/[^$A-Z_a-z0-9]/g, '_');
		if (!base || /^[0-9]/.test(base)) base = '_' + base;
		let name = base;
		let i = 1;
		while (this.conflicts.has(name)) {
			name = `${base}_${i++}`;
		}
		this.conflicts.add(name);
		return name;
	}

}

// ── Binding ────────────────────────────────────────────────────────

/**
 * A single variable declaration in a scope.
 *
 * Knows its kind (state, derived, param, etc.) and optionally carries
 * transform functions (read/assign/update) that the visitor uses to
 * generate reactive accessor calls.
 */
export class Binding {
	scope: Scope;
	name: string;
	kind: BindingKind;
	declaration_kind: DeclarationKind;
	/** The original AST node for this binding */
	node: AstNode | null = null;
	/** Whether this binding is exported from the module */
	exported = false;
	/** Whether the state initializer is an object/array (proxy-backed, direct member access) */
	proxy = false;
	/** All references to this binding */
	references: Array<{ node: AstNode; path: AstNode[] }> = [];
	/** Whether this binding has been reassigned (x = ...) */
	reassigned = false;
	/** Whether this binding has been mutated (x.foo = ...) */
	mutated = false;
	/** Whether this binding is called as a function */
	is_called = false;

	constructor(scope: Scope, name: string, kind: BindingKind, declaration_kind: DeclarationKind = 'let') {
		this.scope = scope;
		this.name = name;
		this.kind = kind;
		this.declaration_kind = declaration_kind;
	}

	/** Whether this binding is a signal that needs $.get() on reads */
	get reactive(): boolean {
		return (
			this.kind === 'state' ||
			this.kind === 'derived' ||
			this.kind === 'prop' ||
			this.kind === 'bind-prop'
		);
	}

	/** Whether this binding can be written with $.set() */
	get writable(): boolean {
		return (
			this.kind === 'state' ||
			this.kind === 'prop' ||
			this.kind === 'bind-prop'
		);
	}

	/**
	 * Whether member access on this binding should stay direct (no $.get on the object).
	 * Proxy-backed state, derived values, and props all use direct member access
	 * because the runtime handles reactivity at the property level.
	 */
	get directMemberAccess(): boolean {
		return (
			this.proxy ||
			this.kind === 'derived' ||
			this.kind === 'bind-prop' ||
			this.kind === 'rest-prop'
		);
	}
}

// ── Scope ──────────────────────────────────────────────────────────

/**
 * A lexical scope containing variable declarations.
 *
 * Scopes form a tree: the module scope is the root, component scopes
 * are children, and inner function/block scopes are nested further.
 *
 * `get(name)` walks up the chain, so inner declarations shadow outer ones.
 */
export class Scope {
	root: ScopeRoot;
	parent: Scope | null;
	declarations: Map<string, Binding> = new Map();
	porous: boolean;
	function_depth: number;

	constructor(root: ScopeRoot, parent: Scope | null = null, porous = false) {
		this.root = root;
		this.parent = parent;
		this.porous = porous;
		this.function_depth = parent
			? parent.function_depth + (porous ? 0 : 1)
			: 0;
	}

	/**
	 * Declare a variable in this scope.
	 * For `var` declarations in porous scopes, the declaration is hoisted to the
	 * nearest non-porous ancestor.
	 */
	declare(
		name: string,
		kind: BindingKind,
		declaration_kind: DeclarationKind = 'let',
	): Binding {
		if (declaration_kind === 'var' && this.porous && this.parent) {
			return this.parent.declare(name, kind, 'var');
		}
		const binding = new Binding(this, name, kind, declaration_kind);
		this.declarations.set(name, binding);
		this.root.conflicts.add(name);
		return binding;
	}

	/** Look up a binding by name, walking up the scope chain */
	get(name: string): Binding | null {
		return this.declarations.get(name) ?? this.parent?.get(name) ?? null;
	}

	/** Create a child scope */
	child(porous = false): Scope {
		return new Scope(this.root, this, porous);
	}

	/** Register a reference to a binding */
	reference(node: AstNode, path: AstNode[]): void {
		if (node.type !== 'Identifier') return;
		const binding = this.get(node.name);
		if (binding) {
			binding.references.push({ node, path });
		}
	}

}


// ── create_scopes ──────────────────────────────────────────────────

/**
 * Walk an OXC AST with zimmerframe and build the scope tree.
 *
 * Returns the root scope and a map from AST nodes to their scopes.
 * The map is used by the `_` universal visitor during transform to
 * thread the correct scope through the walk.
 */

interface ScopeState {
	scope: Scope;
}

/** Map OXC variable declaration kind to our DeclarationKind */
function varDeclKind(kind: VariableDeclarationKind): DeclarationKind {
	if (kind === 'var') return 'var';
	if (kind === 'let') return 'let';
	return 'const';
}

/**
 * Widen zimmerframe's `never` node type to AstNode.
 * OXC's Function interface uses `type: FunctionType` (a union string),
 * so zimmerframe's NodeOf conditional type resolves to `never`. This
 * identity function restores the proper AstNode type for narrowing.
 */
const widen = (n: AstNode): AstNode => n;

export function create_scopes(
	ast: Program,
	source: string,
	root: ScopeRoot,
): { scope: Scope; scopes: Map<AstNode, Scope> } {
	const scopes = new Map<AstNode, Scope>();
	const moduleScope = new Scope(root);
	scopes.set(ast, moduleScope);

	const refs: Array<{ node: AstNode; path: AstNode[]; scope: Scope }> = [];
	const updates: Array<{ node: AstNode; scope: Scope }> = [];

	/** Pre-declare block-level hoisted names (let/const/var, function decls) */
	function hoistBlockDecls(stmts: ReadonlyArray<AstNode>, scope: Scope): void {
		for (const stmt of stmts) {
			if (stmt.type === 'VariableDeclaration') {
				for (const decl of stmt.declarations) {
					collectBindingNames(decl.id, scope, varDeclKind(stmt.kind));
				}
			}
			if (stmt.type === 'FunctionDeclaration') {
				if (stmt.id?.name) scope.declare(stmt.id.name, 'normal', 'function');
			}
		}
	}

	/** Create a block scope, pre-hoist declarations, then continue walk */
	function createBlockScope(
		node: AstNode,
		{ state, path, next }: Context<AstNode, ScopeState>,
	): void {
		if (node.type !== 'BlockStatement') return;
		const parent = path.at(-1);
		// Functions already created their own child scope for the body
		if (
			parent?.type === 'FunctionDeclaration' ||
			parent?.type === 'FunctionExpression' ||
			parent?.type === 'ArrowFunctionExpression'
		) {
			hoistBlockDecls(node.body, state.scope);
			next();
			return;
		}

		const scope = state.scope.child(true);
		scopes.set(node, scope);
		hoistBlockDecls(node.body, scope);
		next({ scope });
	}

	// Pre-declare top-level (module scope) variables and exports.
	for (const stmt of ast.body) {
		if (stmt.type === 'VariableDeclaration') {
			for (const decl of stmt.declarations) {
				collectBindingNames(decl.id, moduleScope, varDeclKind(stmt.kind));
			}
		}
		if (stmt.type === 'ExportNamedDeclaration') {
			const declaration = stmt.declaration;
			if (declaration?.type === 'VariableDeclaration') {
				for (const decl of declaration.declarations) {
					collectBindingNames(decl.id, moduleScope, varDeclKind(declaration.kind));
				}
			}
		}
	}

	walk<AstNode, ScopeState>(ast, { scope: moduleScope }, {
		// ── References ──
		Identifier(node, { state, path }) {
			const parent = path.at(-1);
			if (parent && !isSkippableIdentifier(node, parent)) {
				refs.push({ node, path: path.slice(), scope: state.scope });
			}
		},

		// ── Updates ──
		AssignmentExpression(node, { state, next }) {
			updates.push({ node, scope: state.scope });
			next();
		},

		UpdateExpression(node, { state, next }) {
			updates.push({ node, scope: state.scope });
			next();
		},

		// ── Imports ──
		ImportDeclaration(node, { state }) {
			for (const spec of node.specifiers) {
				if (spec.type === 'ImportSpecifier' || spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
					state.scope.declare(spec.local.name, 'normal', 'import');
				}
			}
			// Don't walk children — specifier identifiers aren't references
		},

		// ── Variable declarations (walk init exprs only, names already hoisted) ──
		VariableDeclaration(node, { state, visit }) {
			for (const decl of node.declarations) {
				if (decl.init) visit(decl.init, state);
			}
		},

		// ── Functions ──
		// OXC's Function interface uses `type: FunctionType` (a union), so
		// zimmerframe's NodeOf resolves to `never`. Use widen() to restore
		// AstNode, then re-narrow to get the proper Function type.
		FunctionDeclaration(node, { state, next }) {
			const fn = widen(node);
			if (fn.type !== 'FunctionDeclaration') return;
			const scope = state.scope.child(false);
			scopes.set(fn, scope);
			declareParams(fn.params, scope);
			next({ scope });
		},

		FunctionExpression(node, { state, next }) {
			const fn = widen(node);
			if (fn.type !== 'FunctionExpression') return;
			const scope = state.scope.child(false);
			scopes.set(fn, scope);
			if (fn.id?.name) scope.declare(fn.id.name, 'normal', 'function');
			declareParams(fn.params, scope);
			next({ scope });
		},

		ArrowFunctionExpression(node, { state, next }) {
			const scope = state.scope.child(false);
			scopes.set(node, scope);
			declareParams(node.params, scope);
			next({ scope });
		},

		// ── Block scopes ──
		BlockStatement: createBlockScope,

		ForStatement(node, { state, next }) {
			const scope = state.scope.child(true);
			scopes.set(node, scope);
			const init = node.init;
			if (init?.type === 'VariableDeclaration') {
				for (const decl of init.declarations) {
					collectBindingNames(decl.id, scope, varDeclKind(init.kind));
				}
			}
			next({ scope });
		},

		ForInStatement(node, { state, next }) {
			const scope = state.scope.child(true);
			scopes.set(node, scope);
			if (node.left.type === 'VariableDeclaration') {
				for (const decl of node.left.declarations) {
					collectBindingNames(decl.id, scope, varDeclKind(node.left.kind));
				}
			}
			next({ scope });
		},

		ForOfStatement(node, { state, next }) {
			const scope = state.scope.child(true);
			scopes.set(node, scope);
			if (node.left.type === 'VariableDeclaration') {
				for (const decl of node.left.declarations) {
					collectBindingNames(decl.id, scope, varDeclKind(node.left.kind));
				}
			}
			next({ scope });
		},

		SwitchStatement(node, { state, visit }) {
			visit(node.discriminant, state);
			for (const cs of node.cases) {
				const caseScope = state.scope.child(true);
				scopes.set(cs, caseScope);
				const caseState = { scope: caseScope };
				if (cs.test) visit(cs.test, caseState);
				for (const stmt of cs.consequent) {
					visit(stmt, caseState);
				}
			}
		},

		CatchClause(node, { state, next }) {
			const scope = state.scope.child(true);
			scopes.set(node, scope);
			if (node.param) collectBindingNames(node.param, scope, 'let');
			next({ scope });
		},
	});

	// Process references
	for (const { node, path, scope } of refs) {
		scope.reference(node, path);
	}

	// Process updates
	for (const { node, scope } of updates) {
		if (node.type === 'AssignmentExpression') {
			if (node.left.type === 'Identifier') {
				const binding = scope.get(node.left.name);
				if (binding) binding.reassigned = true;
			} else if (node.left.type === 'MemberExpression') {
				const obj = getMemberRoot(node.left);
				if (obj) {
					const binding = scope.get(obj);
					if (binding) binding.mutated = true;
				}
			}
		}
		if (node.type === 'UpdateExpression') {
			if (node.argument.type === 'Identifier') {
				const binding = scope.get(node.argument.name);
				if (binding) binding.reassigned = true;
			}
		}
	}

	return { scope: moduleScope, scopes };
}

// ── Helpers ────────────────────────────────────────────────────────

function declareParams(params: ParamPattern[], scope: Scope): void {
	for (const param of params) {
		if (param.type === 'RestElement') {
			collectBindingNames(param.argument, scope, 'rest_param');
		} else if (param.type !== 'TSParameterProperty') {
			collectBindingNames(param, scope, 'param');
		}
	}
}

/** Extract binding names from a pattern and declare them in scope */
function collectBindingNames(pattern: BindingPattern | BindingRestElement, scope: Scope, declaration_kind: DeclarationKind): void {
	if (pattern.type === 'Identifier') {
		if (pattern.name) scope.declare(pattern.name, 'normal', declaration_kind);
		return;
	}
	if (pattern.type === 'RestElement') {
		collectBindingNames(
			pattern.argument,
			scope,
			declaration_kind === 'param' ? 'rest_param' : declaration_kind,
		);
		return;
	}
	if (pattern.type === 'AssignmentPattern') {
		collectBindingNames(pattern.left, scope, declaration_kind);
		return;
	}
	if (pattern.type === 'ObjectPattern') {
		for (const prop of pattern.properties) {
			if (prop.type === 'RestElement') {
				collectBindingNames(prop, scope, declaration_kind);
			} else {
				collectBindingNames(prop.value, scope, declaration_kind);
			}
		}
		return;
	}
	if (pattern.type === 'ArrayPattern') {
		for (const elem of pattern.elements) {
			if (elem) collectBindingNames(elem, scope, declaration_kind);
		}
		return;
	}
}

/** Check if an identifier should be skipped (property key, label, etc.) */
function isSkippableIdentifier(node: AstNode, parent: AstNode): boolean {
	if (parent.type === 'Property' && !parent.computed) return parent.key === node;
	if (parent.type === 'MemberExpression' && !parent.computed) return parent.property === node;
	if (parent.type === 'LabeledStatement') return parent.label === node;
	if (parent.type === 'BreakStatement') return parent.label === node;
	if (parent.type === 'ContinueStatement') return parent.label === node;
	if (parent.type === 'ImportSpecifier') return parent.imported === node && parent.local !== node;
	if (parent.type === 'ExportSpecifier') return parent.exported === node && parent.local !== node;
	return false;
}

/** Get the root identifier name from a member expression chain */
function getMemberRoot(node: AstNode): string | null {
	if (node.type === 'Identifier') return node.name;
	if (node.type === 'MemberExpression') return getMemberRoot(node.object);
	return null;
}

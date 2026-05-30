/**
 * ESTree-compatible AST node builders for DarTsx's code generation.
 *
 * Phase 3 uses these to build a proper AST via zimmerframe node replacement.
 * The AST is then printed by esrap with source maps.
 *
 * Builder functions return `AstNode & { type: K } & T`, which means:
 * - They ARE `AstNode` (can be returned from walk visitors)
 * - They have the specific type literal (for discriminated union usage)
 * - They have the specific builder properties (for composition)
 *
 * The intersection with OXC's discriminated union simplifies correctly:
 * `AstNode & { type: 'CallExpression' }` = `CallExpression`, and OXC's
 * specific property types (Expression, Statement, etc.) are preserved
 * in the intersection because they structurally extend AstNode.
 */
import type { Node, Span } from 'oxc-parser';

/** OXC AST node — the full discriminated union of all span-bearing nodes */
export type AstNode = Extract<Node, Span>;

// ── Loc type (preserved for source-map propagation) ────────────────

export interface SourceLocation {
	start: { line: number; column: number };
	end: { line: number; column: number };
}

// ── Core builder ───────────────────────────────────────────────────

/**
 * Core builder helper. Produces a node that is both:
 * - `AstNode` (for the walk type system)
 * - Specifically typed with the literal `Type` and all properties from `T`
 *
 * The single `as` here is the architectural bridge between builder-produced
 * nodes (structurally valid ESTree) and OXC's strict type definitions.
 * All other code is fully type-safe.
 */
function node<Type extends string, T extends Record<string, unknown>>(
	type: Type, props: T, loc?: SourceLocation | null,
): AstNode & { type: Type; loc?: SourceLocation | null } & T {
	return { type, start: 0, end: 0, loc: loc ?? null, ...props } as AstNode & { type: Type; loc?: SourceLocation | null } & T;
}

// ── Builder functions ──────────────────────────────────────────────

export function program(body: AstNode[]) {
	return node('Program', { sourceType: 'module', body });
}

export function id(name: string, loc?: SourceLocation | null) {
	return node('Identifier', { name }, loc);
}

export function literal(value: string | number | boolean | null, loc?: SourceLocation | null) {
	const raw = typeof value === 'string' ? JSON.stringify(value) : String(value);
	return node('Literal', { value, raw }, loc);
}

/** Build a member expression from a dotted path: "$.state" → $.state */
export function member(path: string, loc?: SourceLocation | null) {
	const parts = path.split('.');
	if (parts.length === 1) return id(parts[0], loc);
	let result: AstNode = id(parts[0]);
	for (let i = 1; i < parts.length; i++) {
		result = node('MemberExpression', { object: result, property: id(parts[i]), computed: false },
			i === parts.length - 1 ? loc : undefined);
	}
	return result;
}

/** Build a call expression: call("$.state", [literal(0)]) */
export function call(callee: string | AstNode, args: AstNode[], loc?: SourceLocation | null) {
	return node('CallExpression', {
		callee: typeof callee === 'string' ? member(callee) : callee,
		arguments: args,
	}, loc);
}

export function array(elements: AstNode[], loc?: SourceLocation | null) {
	return node('ArrayExpression', { elements }, loc);
}

export function object(properties: AstNode[], loc?: SourceLocation | null) {
	return node('ObjectExpression', { properties }, loc);
}

/** A regular key: value property */
export function prop(key: string, value: AstNode, computed = false) {
	return node('Property', {
		key: computed ? id(key) : /^[$A-Z_a-z][$\w]*$/.test(key) ? id(key) : literal(key),
		value,
		kind: 'init',
		computed,
		shorthand: false,
		method: false,
	});
}

/** A getter property: get key() { return expr; } */
export function getter(key: string, body: AstNode[]) {
	return node('Property', {
		key: /^[$A-Z_a-z][$\w]*$/.test(key) ? id(key) : literal(key),
		value: node('FunctionExpression', {
			id: null,
			params: [],
			body: node('BlockStatement', { body }),
			async: false,
		}),
		kind: 'get',
		computed: false,
		shorthand: false,
		method: false,
	});
}

/** A setter property: set key(param) { body } */
export function setter(key: string, param: AstNode, body: AstNode[]) {
	return node('Property', {
		key: /^[$A-Z_a-z][$\w]*$/.test(key) ? id(key) : literal(key),
		value: node('FunctionExpression', {
			id: null,
			params: [param],
			body: node('BlockStatement', { body }),
			async: false,
		}),
		kind: 'set',
		computed: false,
		shorthand: false,
		method: false,
	});
}

export function spread(expr: AstNode, loc?: SourceLocation | null) {
	return node('SpreadElement', { argument: expr }, loc);
}

/** Arrow with expression body: (params) => expr */
export function arrow(params: AstNode[], body: AstNode, loc?: SourceLocation | null) {
	return node('ArrowFunctionExpression', {
		params,
		body,
		async: false,
		expression: true,
	}, loc);
}

/** Arrow with block body: (params) => { stmts } */
export function arrowBlock(params: AstNode[], body: AstNode[], loc?: SourceLocation | null) {
	return node('ArrowFunctionExpression', {
		params,
		body: node('BlockStatement', { body }),
		async: false,
		expression: false,
	}, loc);
}

export function func(name: string, params: AstNode[], body: AstNode[], async_ = false, loc?: SourceLocation | null) {
	return node('FunctionDeclaration', {
		id: id(name),
		params,
		body: node('BlockStatement', { body }),
		async: async_,
	}, loc);
}

export function letDecl(name: string | AstNode, init: AstNode, loc?: SourceLocation | null) {
	return node('VariableDeclaration', {
		kind: 'let',
		declarations: [node('VariableDeclarator', { id: typeof name === 'string' ? id(name) : name, init })],
	}, loc);
}

export function constDecl(name: string | AstNode, init: AstNode, loc?: SourceLocation | null) {
	return node('VariableDeclaration', {
		kind: 'const',
		declarations: [node('VariableDeclarator', { id: typeof name === 'string' ? id(name) : name, init })],
	}, loc);
}

export function declarator(id_: AstNode, init: AstNode) {
	return node('VariableDeclarator', { id: id_, init });
}

export function blockStmt(body: AstNode[], loc?: SourceLocation | null) {
	return node('BlockStatement', { body }, loc);
}

export function forStmt(
	init: AstNode | null,
	test: AstNode | null,
	update: AstNode | null,
	body: AstNode,
	loc?: SourceLocation | null,
) {
	return node('ForStatement', { init, test, update, body }, loc);
}

export function returnStmt(argument: AstNode | null = null, loc?: SourceLocation | null) {
	return node('ReturnStatement', { argument }, loc);
}

export function exprStmt(expression: AstNode, loc?: SourceLocation | null) {
	return node('ExpressionStatement', { expression }, loc);
}

export function assignment(operator: string, left: AstNode, right: AstNode, loc?: SourceLocation | null) {
	return node('AssignmentExpression', { operator, left, right }, loc);
}

export function binary(operator: string, left: AstNode, right: AstNode, loc?: SourceLocation | null) {
	return node('BinaryExpression', { operator, left, right }, loc);
}

export function sequence(expressions: AstNode[], loc?: SourceLocation | null) {
	return node('SequenceExpression', { expressions }, loc);
}

export function importDefault(local: string, source: string) {
	return node('ImportDeclaration', {
		specifiers: [node('ImportDefaultSpecifier', { local: id(local) })],
		source: literal(source),
	});
}

export function exportNamed(declaration: AstNode) {
	return node('ExportNamedDeclaration', {
		declaration,
		specifiers: [],
		source: null,
	});
}

export function exportDefault(declaration: AstNode) {
	return node('ExportDefaultDeclaration', { declaration });
}

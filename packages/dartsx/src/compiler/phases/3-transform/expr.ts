/**
 * AST-based expression transformer.
 *
 * Uses OXC to parse expressions into an AST, then walks the tree to produce
 * span-based text replacements — no regex guessing.
 */
import { parseSync } from 'oxc-parser';
import { STATE_MARKER, DERIVED_MARKER } from '../1-parse';
import type { Expression } from 'oxc-parser';

// ── Helpers ────────────────────────────────────────────────────────

/** Unwrap TypeScript type assertion nodes to get the underlying expression */
function unwrapTSExpression(node: any): any {
	while (node && (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression' || node.type === 'TSNonNullExpression' || node.type === 'TSTypeAssertion')) {
		node = node.expression;
	}
	return node;
}

/**
 * If the expression is a no-arg IIFE like `(() => { ... })()`,
 * return the inner function body so it can be used directly as a derived callback.
 * This avoids the redundant `$.derived(() => (() => { ... })())` pattern.
 */
function unwrapIIFE(expr: string): string | null {
	const trimmed = expr.trim();
	if (!trimmed.startsWith('(')) return null;

	// Find matching ) for the outer wrapper paren
	let depth = 0;
	let outerClose = -1;
	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i];
		if (ch === '(') depth++;
		else if (ch === ')') {
			depth--;
			if (depth === 0) { outerClose = i; break; }
		}
	}
	if (outerClose === -1) return null;

	// After the outer ), the rest must be exactly ()
	const rest = trimmed.slice(outerClose + 1).trim();
	if (rest !== '()') return null;

	// Inner content (without outer parens)
	const inner = trimmed.slice(1, outerClose).trim();

	// Arrow function with no params: () => BODY
	const arrowMatch = inner.match(/^\(\s*\)\s*=>\s*([\s\S]*)$/);
	if (arrowMatch) return arrowMatch[1].trim();

	// Function expression with no params: function() { BODY }
	const funcMatch = inner.match(/^function\s*\(\s*\)\s*(\{[\s\S]*\})$/);
	if (funcMatch) return funcMatch[1].trim();

	return null;
}

/**
 * Wrap an expression as a `$.derived(() => expr)` call string.
 * Automatically unwraps IIFEs and handles object-literal arrow bodies.
 */
export function emitDerived(expr: string): string {
	const iife = unwrapIIFE(expr);
	if (iife) return `$.derived(() => ${iife})`;
	const body = expr.trimStart().startsWith('{') ? `(${expr})` : expr;
	return `$.derived(() => ${body})`;
}

interface Replacement {
	start: number;
	end: number;
	text: string;
}

/**
 * Apply replacements back-to-front so earlier offsets remain valid.
 */
function applyReplacements(source: string, replacements: Replacement[]): string {
	// Sort by start descending so we splice from the end
	const sorted = [...replacements].sort((a, b) => b.start - a.start);
	let result = source;
	for (const r of sorted) {
		result = result.slice(0, r.start) + r.text + result.slice(r.end);
	}
	return result;
}

/**
 * Parse a JS expression string into an AST node.
 * Wraps the expression in a minimal script so OXC can parse it.
 */
function parseExpression(expr: string): Expression | null {
	// Wrap in `0, (expr)` to make it a valid expression statement
	// and the `,` operator lets us extract the right-hand side
	const wrapper = `0,${expr}`;
	const result = parseSync('expr.tsx', wrapper, {
		sourceType: 'script',
		lang: 'tsx',
		preserveParens: false,
	});
	if (result.errors.length > 0) return null;

	const body = result.program.body;
	if (body.length === 0) return null;

	const stmt = body[0];
	if (stmt.type !== 'ExpressionStatement') return null;

	const seq = stmt.expression;
	// The wrapper produces a SequenceExpression: [0, <our expr>]
	if (seq.type === 'SequenceExpression') {
		return seq.expressions[seq.expressions.length - 1];
	}
	return seq;
}

// ── AST walker ─────────────────────────────────────────────────────

type ASTNode = Record<string, any>;

/**
 * Walk all AST nodes depth-first, calling visitor with parent context.
 */
function walk(node: ASTNode, visitor: (n: ASTNode, parent: ASTNode | null, key: string | null) => void, parent: ASTNode | null = null, key: string | null = null): void {
	if (!node || typeof node !== 'object') return;
	visitor(node, parent, key);
	for (const k of Object.keys(node)) {
		const val = node[k];
		if (Array.isArray(val)) {
			for (const item of val) {
				if (item && typeof item === 'object' && item.type) {
					walk(item, visitor, node, k);
				}
			}
		} else if (val && typeof val === 'object' && val.type) {
			walk(val, visitor, node, k);
		}
	}
}

// ── The offset the wrapper `0,` adds ──────────────────────────────

const WRAPPER_OFFSET = 2; // "0," is 2 chars

// ── Scope helpers ──────────────────────────────────────────────────

/** Returns true if `node` introduces a new variable scope. */
function isScopeBoundary(node: ASTNode): boolean {
	const t = node.type;
	return (
		t === 'FunctionDeclaration' ||
		t === 'FunctionExpression' ||
		t === 'ArrowFunctionExpression' ||
		t === 'BlockStatement' ||
		t === 'ForStatement' ||
		t === 'ForInStatement' ||
		t === 'ForOfStatement' ||
		t === 'CatchClause'
	);
}

/**
 * Collect all names declared at the immediate scope level of a node.
 * For functions/arrows: params + body-level declarations.
 * For blocks/for/catch: their own declarations.
 * Does NOT recurse into nested scopes.
 */
function collectScopeDeclarations(node: ASTNode): Set<string> {
	const names = new Set<string>();
	const t = node.type;

	// Collect function/arrow params
	if (t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression') {
		const params = node.params?.items || node.params || [];
		for (const p of params) {
			collectBindingNames(p, names);
		}
	}

	// Catch clause: the catch param
	if (t === 'CatchClause' && node.param) {
		collectBindingNames(node.param, names);
	}

	// For-statement init declarations
	if (t === 'ForStatement' && node.init?.type === 'VariableDeclaration') {
		for (const decl of node.init.declarations || []) {
			if (decl.id) collectBindingNames(decl.id, names);
		}
	}
	// ForIn/ForOf left
	if ((t === 'ForInStatement' || t === 'ForOfStatement') && node.left?.type === 'VariableDeclaration') {
		for (const decl of node.left.declarations || []) {
			if (decl.id) collectBindingNames(decl.id, names);
		}
	}

	// Block-level variable declarations (let/const — also var for simplicity)
	const stmts = getBlockStatements(node);
	for (const stmt of stmts) {
		if (stmt.type === 'VariableDeclaration') {
			for (const decl of stmt.declarations || []) {
				if (decl.id) collectBindingNames(decl.id, names);
			}
		}
		// Function declarations in blocks
		if (stmt.type === 'FunctionDeclaration' && stmt.id?.name) {
			names.add(stmt.id.name);
		}
	}

	return names;
}

/** Get the direct child statements of a scope-introducing node. */
function getBlockStatements(node: ASTNode): ASTNode[] {
	const t = node.type;
	if (t === 'BlockStatement') return node.body || node.statements || [];
	if (t === 'FunctionDeclaration' || t === 'FunctionExpression') {
		const body = node.body;
		if (body?.type === 'BlockStatement' || body?.type === 'FunctionBody') {
			return body.body || body.statements || [];
		}
	}
	if (t === 'ArrowFunctionExpression') {
		const body = node.body;
		if (body?.type === 'BlockStatement' || body?.type === 'FunctionBody') {
			return body.body || body.statements || [];
		}
	}
	if (t === 'CatchClause') {
		const body = node.body;
		if (body) return body.body || body.statements || [];
	}
	if (t === 'ForStatement' || t === 'ForInStatement' || t === 'ForOfStatement') {
		const body = node.body;
		if (body?.type === 'BlockStatement') return body.body || body.statements || [];
	}
	return [];
}

/** Extract binding names from a pattern (Identifier, ObjectPattern, ArrayPattern, RestElement, etc.) */
function collectBindingNames(pattern: ASTNode, names: Set<string>): void {
	if (!pattern) return;
	const t = pattern.type;
	if (t === 'Identifier' || t === 'BindingIdentifier') {
		if (pattern.name) names.add(pattern.name);
		return;
	}
	if (t === 'FormalParameter') {
		collectBindingNames(pattern.pattern, names);
		return;
	}
	if (t === 'RestElement') {
		collectBindingNames(pattern.argument, names);
		return;
	}
	if (t === 'AssignmentPattern') {
		collectBindingNames(pattern.left, names);
		return;
	}
	if (t === 'ObjectPattern') {
		for (const prop of pattern.properties || []) {
			if (prop.type === 'RestElement') {
				collectBindingNames(prop, names);
			} else {
				collectBindingNames(prop.value || prop.key, names);
			}
		}
		return;
	}
	if (t === 'ArrayPattern') {
		for (const elem of pattern.elements || []) {
			if (elem) collectBindingNames(elem, names);
		}
		return;
	}
}

/**
 * Check if an AST node (by span) is inside any of the given scope boundaries.
 * Returns the pruned reactive set for that position.
 */
function pruneReactiveVarsForScope(
	scopeStack: Array<{ start: number; end: number; declared: Set<string> }>,
	nodeStart: number,
	nodeEnd: number,
	baseReactiveVars: Set<string>,
): Set<string> {
	let vars = baseReactiveVars;
	for (const scope of scopeStack) {
		if (nodeStart >= scope.start && nodeEnd <= scope.end && scope.declared.size > 0) {
			// Lazily create pruned set only when needed
			if (vars === baseReactiveVars) vars = new Set(baseReactiveVars);
			for (const name of scope.declared) {
				vars.delete(name);
			}
		}
	}
	return vars;
}

/**
 * Walk an AST collecting all inner scope boundaries with their declared names.
 * Returns a flat list of { start, end, declared } for each scope-introducing node.
 */
function collectAllScopeBoundaries(root: ASTNode): Array<{ start: number; end: number; declared: Set<string> }> {
	const boundaries: Array<{ start: number; end: number; declared: Set<string> }> = [];
	walk(root, (node) => {
		if (isScopeBoundary(node)) {
			const declared = collectScopeDeclarations(node);
			if (declared.size > 0) {
				boundaries.push({ start: node.start, end: node.end, declared });
			}
		}
	});
	return boundaries;
}

// ── Shared helpers ─────────────────────────────────────────────────

/** Walk an AST and collect exclusion zones for args at reactive call positions. */
function collectExclusionZones(ast: ASTNode, reactiveCallTargets: Map<string, Set<number>>): { start: number; end: number }[] {
	const zones: { start: number; end: number }[] = [];
	walk(ast, (node) => {
		if (
			node.type === 'CallExpression' &&
			node.callee?.type === 'Identifier'
		) {
			const indices = reactiveCallTargets.get(node.callee.name);
			if (indices) {
				for (const idx of indices) {
					const arg = node.arguments?.[idx];
					if (arg) zones.push({ start: arg.start, end: arg.end });
				}
			}
		}
	});
	return zones;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Transform an expression by wrapping reactive variable reads in `$.get()`.
 * Uses OXC AST to precisely identify `Identifier` nodes.
 */
export function wrapReadsInGet(
	expr: string,
	reactiveVars: Set<string>,
	directMemberAccessVars?: Set<string>,
	reactiveCallTargets?: Map<string, Set<number>>,
): string {
	const ast = parseExpression(expr);
	if (!ast) return expr; // fallback: return unchanged

	const replacements: Replacement[] = [];

	// Build exclusion zones from reactive call targets
	const exclusionZones = reactiveCallTargets ? collectExclusionZones(ast, reactiveCallTargets) : [];

	// Collect all inner scope boundaries for scope-aware shadowing
	const scopeBoundaries = collectAllScopeBoundaries(ast);

	walk(ast, (node, parent, key) => {
		if (node.type === 'Identifier' && reactiveVars.has(node.name)) {
			// Check if this identifier is shadowed by an inner scope declaration
			const effectiveVars = pruneReactiveVarsForScope(scopeBoundaries, node.start, node.end, reactiveVars);
			if (!effectiveVars.has(node.name)) return;

			// Skip the root object of a member expression (obj.count / obj[expr]).
			// Object-valued reactive roots are proxy-backed at runtime, so member
			// access should stay as `obj.prop`, not `$.get(obj).prop`.
			const effectiveDMA = directMemberAccessVars
				? pruneReactiveVarsForScope(scopeBoundaries, node.start, node.end, directMemberAccessVars)
				: undefined;
			if (parent?.type === 'MemberExpression' && key === 'object' && effectiveDMA?.has(node.name)) {
				return;
			}
			// Skip if this is the property of a non-computed member expression (obj.count)
			if (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) {
				return;
			}
			// Skip non-computed property keys in object literals: { count: 42 }
			if (parent?.type === 'Property' && key === 'key' && !parent.computed) {
				return;
			}
			const id = node;
			// Offset from wrapper
			const start = id.start - WRAPPER_OFFSET;
			const end = id.end - WRAPPER_OFFSET;
			// Skip if inside an exclusion zone (reactive call arg)
			if (exclusionZones.some(z => id.start >= z.start && id.end <= z.end)) return;
			// Expand shorthand properties: { label } → { label: $.get(label) }
			if (parent?.type === 'Property' && parent.shorthand && key === 'value') {
				replacements.push({ start, end, text: `${id.name}: $.get(${id.name})` });
			} else {
				replacements.push({ start, end, text: `$.get(${id.name})` });
			}
		}
	});

	return applyReplacements(expr, replacements);
}

/**
 * Transform an event handler expression. Handles:
 * - Arrow functions: (e) => count++ → (e) => $.set(count, $.get(count) + 1)
 * - Bare function refs: handleClick → handleClick (no transform)
 * - Inline expressions: count++ → () => $.set(count, $.get(count) + 1)
 * - Assignments: count = 5 → () => $.set(count, 5)
 */
export function transformEventHandler(
	raw: string,
	reactiveVars: Set<string>,
	directMemberAccessVars?: Set<string>,
): string {
	const trimmed = raw.trim();
	const ast = parseExpression(trimmed);

	// Function expressions — transformBodyStatement handles the full string
	// via span-based replacements, preserving arrow/function structure
	if (ast?.type === 'ArrowFunctionExpression' || ast?.type === 'FunctionExpression') {
		return transformBodyStatement(trimmed, reactiveVars, undefined, directMemberAccessVars);
	}

	// Function references — just wrap reads (don't add () =>)
	if (ast?.type === 'Identifier' || ast?.type === 'MemberExpression') {
		return wrapReadsInGet(trimmed, reactiveVars, directMemberAccessVars);
	}

	// Inline expression (update, assignment, call, etc.) — transform and wrap in arrow
	return `() => ${transformBodyStatement(trimmed, reactiveVars, undefined, directMemberAccessVars)}`;
}

// ── Body statement transformer ─────────────────────────────────────

/**
 * Transform a body statement string, converting reactive variable reads to
 * `$.get()` and assignments to `$.set()`. Handles special cases like
 * `effect(dep, callback)` where the dep argument must remain a Signal object.
 */
export function transformBodyStatement(
	stmt: string,
	reactiveVars: Set<string>,
	reactiveCallTargets?: Map<string, Set<number>>,
	directMemberAccessVars?: Set<string>,
): string {
	// Detect any remaining /*@s*/ or /*@d*/ markers (from non-component scopes)
	const localStateVars = new Set<string>();
	const localDerivedVars = new Set<string>();
	const stateMarkerRegex = /let\s+(\w+)\s*\/\*@s\*\//g;
	const derivedMarkerRegex = /const\s+(\w+)\s*\/\*@d\*\//g;
	let m;
	while ((m = stateMarkerRegex.exec(stmt)) !== null) localStateVars.add(m[1]);
	while ((m = derivedMarkerRegex.exec(stmt)) !== null) localDerivedVars.add(m[1]);

	// Merge local reactive vars with the incoming set
	const allReactiveVars = new Set(reactiveVars);
	for (const v of localStateVars) allReactiveVars.add(v);
	for (const v of localDerivedVars) allReactiveVars.add(v);
	const allDirectMemberAccessVars = new Set(directMemberAccessVars);
	for (const v of localDerivedVars) allDirectMemberAccessVars.add(v);

	if (allReactiveVars.size === 0) return stmt;

	let result = parseSync('stmt.tsx', stmt, {
		sourceType: 'module',
		lang: 'tsx',
	});

	// If parsing fails (e.g. `return` outside function), wrap in a function
	let unwrapOffset = 0;
	if (result.errors.length > 0) {
		const wrapper = `function __(){${stmt}}`;
		result = parseSync('stmt.tsx', wrapper, {
			sourceType: 'module',
			lang: 'tsx',
		});
		if (result.errors.length > 0) return stmt;
		unwrapOffset = 'function __(){'.length;
	}

	// Detect local proxy-backed state vars (object/array/new inits) and add to directMemberAccessVars
	if (localStateVars.size > 0) {
		walk(result.program, (node) => {
			if (node.type !== 'VariableDeclaration') return;
			for (const decl of node.declarations || []) {
				const name = decl.id?.name;
				if (!name || !localStateVars.has(name) || !decl.init) continue;
				const init = unwrapTSExpression(decl.init);
				const t = init.type;
				if (t === 'ObjectExpression' || t === 'ArrayExpression' || t === 'NewExpression') {
					allDirectMemberAccessVars.add(name);
				}
			}
		});
	}

	const replacements: Replacement[] = [];
	const coveredSpans: { start: number; end: number }[] = [];

	// Helper to translate AST spans back to original stmt coordinates
	const s = (pos: number) => pos - unwrapOffset;

	// Helper: get the root identifier of a member expression chain (obj.a.b → "obj")
	function getMemberRoot(node: ASTNode): string | null {
		if (node.type === 'Identifier') return node.name;
		if (node.type === 'MemberExpression') return getMemberRoot(node.object);
		return null;
	}

	// Helper: wrap a member expression dep in $.derived(() => ...)
	function wrapDepIfNeeded(arg: ASTNode): void {
		if (arg.type === 'MemberExpression') {
			const root = getMemberRoot(arg);
			if (root && allReactiveVars.has(root)) {
				const exprText = stmt.slice(s(arg.start), s(arg.end));
				replacements.push({ start: s(arg.start), end: s(arg.end), text: `$.derived(() => ${exprText})` });
			}
		}
	}

	// Pre-compute derived init spans to avoid conflicting replacements with Pass 0
	const derivedInitSpans: { start: number; end: number }[] = [];
	if (localDerivedVars.size > 0) {
		walk(result.program, (node) => {
			if (node.type !== 'VariableDeclaration') return;
			for (const decl of node.declarations || []) {
				if (localDerivedVars.has(decl.id?.name) && decl.init) {
					derivedInitSpans.push({ start: decl.init.start, end: decl.init.end });
				}
			}
		});
	}

	// Collect exclusion zones for args at reactive call positions.
	// These args must remain as Signal objects (not unwrapped via $.get()).
	// For member expression args on a reactive root, wrap in $.derived()
	// so the callee receives a Derived signal.
	const exclusionZones = reactiveCallTargets
		? collectExclusionZones(result.program, reactiveCallTargets)
		: [];

	// For each exclusion zone arg, wrap member expressions in $.derived()
	for (const zone of exclusionZones) {
		// Skip if inside a derived init (Pass 0 handles the entire expression)
		if (derivedInitSpans.some(d => zone.start >= d.start && zone.end <= d.end)) continue;
		// Find the AST node for this zone to check its type
		walk(result.program, (node) => {
			if (node.start !== zone.start || node.end !== zone.end) return;
			if (node.type === 'ArrayExpression' && node.elements) {
				for (const elem of node.elements) {
					if (elem) wrapDepIfNeeded(elem);
				}
			} else {
				wrapDepIfNeeded(node);
			}
		});
	}

	// Collect inner scope boundaries for scope-aware shadowing in Pass 1 & 2.
	const scopeBoundaries = collectAllScopeBoundaries(result.program);

	/** Check if a name is reactive at the given AST position (respecting scope shadows). */
	function isReactiveAt(name: string, nodeStart: number, nodeEnd: number): boolean {
		// Local reactive vars (from /*@s*/ and /*@d*/ markers in this statement) cannot
		// be shadowed by their own declarations — they ARE the reactive state.
		// Only incoming reactive vars (from the parent scope) can be shadowed.
		if (localReactiveAll.has(name)) return allReactiveVars.has(name);
		return pruneReactiveVarsForScope(scopeBoundaries, nodeStart, nodeEnd, allReactiveVars).has(name);
	}
	/** Check if a name has direct member access at the given AST position. */
	function isDMAAt(name: string, nodeStart: number, nodeEnd: number): boolean {
		return pruneReactiveVarsForScope(scopeBoundaries, nodeStart, nodeEnd, allDirectMemberAccessVars).has(name);
	}

	// Pass 0: Transform /*@s*/ and /*@d*/ declarations in nested scopes
	const localReactiveAll = new Set([...localStateVars, ...localDerivedVars]);
	if (localReactiveAll.size > 0) {
		walk(result.program, (node) => {
			if (node.type !== 'VariableDeclaration') return;
			for (const decl of node.declarations || []) {
				const name = decl.id?.name;
				if (!name) continue;
				const markerText = stmt.slice(s(decl.id.end), s(decl.init?.start ?? decl.id.end));
				if (localStateVars.has(name) && (markerText.includes(STATE_MARKER) || !decl.init)) {
					if (decl.init) {
						// let name /*@s*/ = expr → let name = $.state(expr)
						// Strip TS type assertions (as any, satisfies T, etc.) from the initializer
						const initNode = unwrapTSExpression(decl.init);
						const initStart = s(initNode.start);
						const initEnd = s(initNode.end);
						replacements.push({ start: s(decl.id.end), end: initStart, text: ' = $.state(' });
						replacements.push({ start: initEnd, end: s(decl.init.end), text: ')' });
						coveredSpans.push({ start: decl.id.start, end: decl.init.end });
					} else {
						// let name /*@s*/ → let name = $.state()
						// Find end of trailing marker comment + whitespace
						const afterId = s(decl.id.end);
						const lineEnd = stmt.indexOf('\n', afterId);
						const trailingEnd = lineEnd === -1 ? stmt.length : lineEnd;
						replacements.push({ start: afterId, end: trailingEnd, text: ' = $.state()' });
						coveredSpans.push({ start: decl.id.start, end: decl.id.end });
					}
				} else if (localDerivedVars.has(name) && markerText.includes(DERIVED_MARKER)) {
					// const name /*@d*/ = expr → const name = $.derived(() => expr)
					const initStart = s(decl.init.start);
					const initEnd = s(decl.init.end);
					const initExpr = stmt.slice(initStart, initEnd);
					const wrappedInit = wrapReadsInGet(initExpr, allReactiveVars, allDirectMemberAccessVars);
					replacements.push({ start: s(decl.id.end), end: initEnd, text: ` = ${emitDerived(wrappedInit)}` });
					coveredSpans.push({ start: decl.id.start, end: decl.init.end });
				}
			}
		});

		// Pass 0b: Return object shorthand properties for local state/derived → getters
		walk(result.program, (node, parent) => {
			if (node.type !== 'ReturnStatement' || !node.argument) return;
			const obj = node.argument;
			if (obj.type !== 'ObjectExpression') return;
			for (const prop of obj.properties || []) {
				if (prop.type !== 'ObjectProperty' && prop.type !== 'Property') continue;
				const valNode = prop.value;
				if (valNode?.type !== 'Identifier') continue;
				if (!localReactiveAll.has(valNode.name)) continue;
				// Replace `name` or `name: name` property → `get name() { return $.get(name) }`
				replacements.push({
					start: s(prop.start),
					end: s(prop.end),
					text: `get ${valNode.name}() { return $.get(${valNode.name}) }`,
				});
				coveredSpans.push({ start: prop.start, end: prop.end });
			}
		});
	}

	// Pass 1: Assignments and updates to reactive vars
	walk(result.program, (node, parent, key) => {
		if (node.type === 'AssignmentExpression') {
			const left = node.left;
			if (left?.type === 'Identifier' && isReactiveAt(left.name, left.start, left.end)) {
				const name = left.name;
				const rhsSource = stmt.slice(s(node.right.start), s(node.right.end));
				const wrappedRhs = wrapReadsInGet(rhsSource, allReactiveVars, allDirectMemberAccessVars);

				const text = node.operator === '='
					? `$.set(${name}, ${wrappedRhs})`
					: `$.set(${name}, $.get(${name}) ${node.operator.slice(0, -1)} ${wrappedRhs})`;

				replacements.push({ start: s(node.start), end: s(node.end), text });
				coveredSpans.push({ start: node.start, end: node.end });
			}
		}

		if (node.type === 'UpdateExpression') {
			const arg = node.argument;
			if (arg?.type === 'Identifier' && isReactiveAt(arg.name, arg.start, arg.end)) {
				const delta = node.operator === '++' ? '+ 1' : '- 1';
				replacements.push({
					start: s(node.start),
					end: s(node.end),
					text: `$.set(${arg.name}, $.get(${arg.name}) ${delta})`,
				});
				coveredSpans.push({ start: node.start, end: node.end });
			}
		}
	});

	// Pass 2: Identifier reads not already covered by assignment/update transforms
	walk(result.program, (node, parent, key) => {
		if (node.type !== 'Identifier' || !allReactiveVars.has(node.name)) return;
		// Scope-aware check: skip if shadowed by an inner scope declaration
		if (!isReactiveAt(node.name, node.start, node.end)) return;
		// Skip assignment LHS
		if (parent?.type === 'AssignmentExpression' && key === 'left') return;
		// Skip update argument
		if (parent?.type === 'UpdateExpression') return;
		// Skip the root object of a member expression (obj.x / obj[expr])
		if (parent?.type === 'MemberExpression' && key === 'object' && isDMAAt(node.name, node.start, node.end)) return;
		// Skip non-computed member property (obj.x)
		if (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
		// Skip non-computed property keys in object literals: { count: 42 }
		if ((parent?.type === 'ObjectProperty' || parent?.type === 'Property') && key === 'key' && !parent.computed) return;
		// Skip function param declarations (BindingIdentifier)
		if (parent?.type === 'FormalParameter' || parent?.type === 'FormalParameters') return;
		// Skip variable declarator id (LHS of let/const)
		if (parent?.type === 'VariableDeclarator' && key === 'id') return;

		const start = node.start;
		const end = node.end;
		// Skip if inside a span already covered by previous passes
		if (coveredSpans.some((c) => start >= c.start && end <= c.end)) return;
		// Skip if inside an exclusion zone (reactive call arg)
		if (exclusionZones.some((z) => start >= z.start && end <= z.end)) return;

		// Shorthand property: { count } → { count: $.get(count) }
		if ((parent?.type === 'ObjectProperty' || parent?.type === 'Property') && parent.shorthand && key === 'value') {
			replacements.push({ start: s(parent.start), end: s(parent.end), text: `${node.name}: $.get(${node.name})` });
			coveredSpans.push({ start: parent.start, end: parent.end });
			return;
		}

		replacements.push({ start: s(start), end: s(end), text: `$.get(${node.name})` });
	});

	return replacements.length > 0 ? applyReplacements(stmt, replacements) : stmt;
}

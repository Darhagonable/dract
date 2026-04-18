/**
 * AST-based expression transformer.
 *
 * Uses OXC to parse expressions into an AST, then walks the tree to produce
 * span-based text replacements — no regex guessing.
 */
import { parseSync } from 'oxc-parser';
import { STATE_MARKER, DERIVED_MARKER } from '../1-parse';
import type {
	Expression,
	AssignmentExpression,
	UpdateExpression,
	IdentifierReference,
} from 'oxc-parser';

// ── Helpers ────────────────────────────────────────────────────────

/** Unwrap TypeScript type assertion nodes to get the underlying expression */
function unwrapTSExpression(node: any): any {
	while (node && (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression' || node.type === 'TSNonNullExpression' || node.type === 'TSTypeAssertion')) {
		node = node.expression;
	}
	return node;
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

// ── Public API ─────────────────────────────────────────────────────

/**
 * Transform an expression by wrapping reactive variable reads in `$.get()`.
 * Uses OXC AST to precisely identify `Identifier` nodes.
 */
export function wrapReadsInGet(
	expr: string,
	reactiveVars: Set<string>,
	proxyVars?: Set<string>,
	directMemberAccessVars?: Set<string>,
): string {
	const ast = parseExpression(expr);
	if (!ast) return expr; // fallback: return unchanged

	const replacements: Replacement[] = [];

	walk(ast, (node, parent, key) => {
		if (node.type === 'Identifier' && reactiveVars.has(node.name)) {
			// Skip the root object of a member expression (obj.count / obj[expr]).
			// Object-valued reactive roots are proxy-backed at runtime, so member
			// access should stay as `obj.prop`, not `$.get(obj).prop`.
			if (parent?.type === 'MemberExpression' && key === 'object' && directMemberAccessVars?.has(node.name)) {
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
	proxyVars?: Set<string>,
	directMemberAccessVars?: Set<string>,
): string {
	const trimmed = raw.trim();
	const ast = parseExpression(trimmed);
	if (!ast) return `() => ${wrapReadsInGet(trimmed, reactiveVars, proxyVars, directMemberAccessVars)}`;

	// Arrow function: transform the body
	if (ast.type === 'ArrowFunctionExpression') {
		const arrow = ast;
		// Get the params text from source
		const arrowStart = ast.start - WRAPPER_OFFSET;
		// Find the `=>` in the source
		const arrowIdx = trimmed.indexOf('=>', arrowStart);
		const prefix = trimmed.slice(arrowStart, arrowIdx + 2);

		// Get the body expression
		if (arrow.expression && arrow.body && arrow.body.type) {
			const bodyStart = arrow.body.start - WRAPPER_OFFSET;
			const bodyEnd = arrow.body.end - WRAPPER_OFFSET;
			const bodySource = trimmed.slice(bodyStart, bodyEnd);
			// Re-parse body so span offsets are relative to bodySource
			const bodyAST = parseExpression(bodySource);
			const transformedBody = bodyAST
				? transformExpr(bodySource, bodyAST, reactiveVars, proxyVars, directMemberAccessVars)
				: wrapReadsInGet(bodySource, reactiveVars, proxyVars, directMemberAccessVars);
			return `${prefix} ${transformedBody}`;
		}
		// Block body — just wrap reads
		return wrapReadsInGet(trimmed, reactiveVars, proxyVars, directMemberAccessVars);
	}

	// Bare identifier (function reference) — just wrap if reactive
	if (ast.type === 'Identifier') {
		return wrapReadsInGet(trimmed, reactiveVars, proxyVars, directMemberAccessVars);
	}

	// Member expression function reference (obj.fn) — return as-is if no reactive reads
	if (ast.type === 'MemberExpression') {
		const wrapped = wrapReadsInGet(trimmed, reactiveVars, proxyVars, directMemberAccessVars);
		return wrapped;
	}

	// Update or assignment — wrap in arrow
	const transformed = transformExpr(trimmed, ast, reactiveVars, proxyVars, directMemberAccessVars);
	if (transformed !== trimmed) {
		return `() => ${transformed}`;
	}

	// Fallback: wrap reads and put in arrow
	return `() => ${wrapReadsInGet(trimmed, reactiveVars, proxyVars, directMemberAccessVars)}`;
}

/**
 * Transform a single expression node, handling assignments and updates.
 */
function transformExpr(
	source: string,
	node: ASTNode,
	reactiveVars: Set<string>,
	proxyVars?: Set<string>,
	directMemberAccessVars?: Set<string>,
): string {
	// UpdateExpression: count++ / count-- / ++count / --count
	if (node.type === 'UpdateExpression') {
		const update = node;
		const arg = update.argument;
		if (arg.type === 'Identifier' && reactiveVars.has(arg.name)) {
			const name = arg.name;
			const delta = update.operator === '++' ? '+ 1' : '- 1';
			return `$.set(${name}, $.get(${name}) ${delta})`;
		}
	}

	// AssignmentExpression: count = x / count += x / etc.
	if (node.type === 'AssignmentExpression') {
		const assign = node;
		const left = assign.left;
		if (left.type === 'Identifier' && reactiveVars.has(left.name)) {
			const name = left.name;
			const rhsStart = assign.right.start - WRAPPER_OFFSET;
			const rhsEnd = assign.right.end - WRAPPER_OFFSET;
			const rhsSource = source.slice(rhsStart, rhsEnd);
			const transformedRhs = wrapReadsInGet(rhsSource, reactiveVars, proxyVars, directMemberAccessVars);

			if (assign.operator === '=') {
				return `$.set(${name}, ${transformedRhs})`;
			}
			// Compound: +=, -=, *=, /=, etc.
			const op = assign.operator.slice(0, -1); // remove the '='
			return `$.set(${name}, $.get(${name}) ${op} ${transformedRhs})`;
		}
	}

	// SequenceExpression: transform each part
	if (node.type === 'SequenceExpression') {
		const seq = node;
		const parts = seq.expressions.map((expr: ASTNode) => {
			const s = expr.start - WRAPPER_OFFSET;
			const e = expr.end - WRAPPER_OFFSET;
			const subSource = source.slice(s, e);
			// Re-parse each sub-expression for correct span offsets
			const subAST = parseExpression(subSource);
			return subAST
				? transformExpr(subSource, subAST, reactiveVars, proxyVars, directMemberAccessVars)
				: wrapReadsInGet(subSource, reactiveVars, proxyVars, directMemberAccessVars);
		});
		return parts.join(', ');
	}

	// Default: just wrap reads
	return wrapReadsInGet(source, reactiveVars, proxyVars, directMemberAccessVars);
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
	proxyVars?: Set<string>,
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

	// Collect exclusion zones: first argument of effect() calls
	// (deps must remain as Signal objects, not unwrapped via $.get())
	// and args at reactive positions for functions with reactive params.
	// For any exclusion-zone arg that is a member expression on a reactive root,
	// wrap it in $.derived(() => ...) so the callee receives a Derived signal.
	// Skip wrapping for args inside derived inits (Pass 0 handles those).
	const exclusionZones: { start: number; end: number }[] = [];

	function addExclusionArg(arg: ASTNode): void {
		exclusionZones.push({ start: arg.start, end: arg.end });
		// Skip wrapping if inside a derived init (Pass 0 handles the entire expression)
		if (derivedInitSpans.some(d => arg.start >= d.start && arg.end <= d.end)) return;
		// Array literal of deps: wrap each element individually
		if (arg.type === 'ArrayExpression' && arg.elements) {
			for (const elem of arg.elements) {
				if (elem) wrapDepIfNeeded(elem);
			}
		} else {
			wrapDepIfNeeded(arg);
		}
	}

	walk(result.program, (node) => {
		// Exclude args at reactive positions for functions with reactive params
		if (
			reactiveCallTargets &&
			node.type === 'CallExpression' &&
			node.callee?.type === 'Identifier'
		) {
			const indices = reactiveCallTargets.get(node.callee.name);
			if (indices) {
				for (const idx of indices) {
					const arg = node.arguments?.[idx];
					if (arg) {
						addExclusionArg(arg);
					}
				}
			}
		}
	});

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
					const wrappedInit = wrapReadsInGet(initExpr, allReactiveVars, proxyVars, allDirectMemberAccessVars);
					const derivedBody = wrappedInit.trimStart().startsWith('{') ? `(${wrappedInit})` : wrappedInit;
					replacements.push({ start: s(decl.id.end), end: initEnd, text: ` = $.derived(() => ${derivedBody})` });
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
			if (left?.type === 'Identifier' && allReactiveVars.has(left.name)) {
				const name = left.name;
				const rhsSource = stmt.slice(s(node.right.start), s(node.right.end));
				const wrappedRhs = wrapReadsInGet(rhsSource, allReactiveVars, proxyVars, allDirectMemberAccessVars);

				const text = node.operator === '='
					? `$.set(${name}, ${wrappedRhs})`
					: `$.set(${name}, $.get(${name}) ${node.operator.slice(0, -1)} ${wrappedRhs})`;

				replacements.push({ start: s(node.start), end: s(node.end), text });
				coveredSpans.push({ start: node.start, end: node.end });
			}
		}

		if (node.type === 'UpdateExpression') {
			const arg = node.argument;
			if (arg?.type === 'Identifier' && allReactiveVars.has(arg.name)) {
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
		// Skip assignment LHS
		if (parent?.type === 'AssignmentExpression' && key === 'left') return;
		// Skip update argument
		if (parent?.type === 'UpdateExpression') return;
		// Skip the root object of a member expression (obj.x / obj[expr])
		if (parent?.type === 'MemberExpression' && key === 'object' && allDirectMemberAccessVars.has(node.name)) return;
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
		// Skip if inside an exclusion zone (effect dep argument or reactive call arg)
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

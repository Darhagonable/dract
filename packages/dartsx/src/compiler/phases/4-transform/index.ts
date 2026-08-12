/**
 * Phase 4 — Transform
 *
 * Walks the OXC AST with zimmerframe and replaces nodes to produce
 * the output JavaScript AST. Uses the scope tree and binding metadata
 * from Phase 3 to perform reactive transformations.
 *
 * Key visitors:
 * - `_` (universal): scope threading
 * - `Program`: runtime import injection
 * - `FunctionDeclaration`: component rewrite (params → $$props)
 * - `VariableDeclaration`: state/derived → $.state()/$.derived()
 * - `Identifier`: reactive reads → $.get()
 * - `AssignmentExpression`: reactive writes → $.set()
 * - `UpdateExpression`: count++ → $.set(count, $.get(count) + 1)
 * - JSX nodes: → $.jsx() runtime calls
 * - `CallExpression`: __try/__html → $.try/$.html, IIFEs → $.if/$.for/etc.
 */
import { walk, type Context } from 'zimmerframe';
import type { AnalysisResult, ComponentInfo, StyleBlockIR } from '../3-analyze';
import { STATE_MARKER, DERIVED_MARKER, STYLE_MARKER_PREFIX } from '../1-preprocess';
import type { Scope } from '../../scope';
import { scopeHash, SCOPE_ATTR, rewriteScopedCSS, extractCSSVars, type CSSVar } from './css';
import * as b from '../../builders';
import type { AstNode } from '../../builders';
import { print, type PrintOptions } from 'esrap';
import tsx from 'esrap/languages/tsx';
import { decodeHTML } from 'entities';
import { parseSync } from 'oxc-parser';
import type {
	Expression,
	Argument,
	ParamPattern,
	Function as OxcFunction,
	VariableDeclaration,
	AssignmentExpression,
	UpdateExpression,
	CallExpression,
	ArrowFunctionExpression,
	BlockStatement,
	IfStatement,
	ForOfStatement,
	ForInStatement,
	ForStatement,
	SwitchStatement,
	JSXChild,
	JSXElement,
	JSXElementName,
	JSXAttributeName,
	JSXAttribute,
	JSXMemberExpressionObject,
	JSXFragment,
	JSXExpressionContainer,
	Program,
	ReturnStatement,
	ExpressionStatement,
	ObjectPattern,
	ArrayPattern,
	BindingProperty,
	BindingRestElement,
} from 'oxc-parser';

// ── Types ──────────────────────────────────────────────────────────

/** zimmerframe context specialized for our transform walk */
type WalkContext = Context<AstNode, TransformState>;

export interface TransformResult {
	code: string;
	map: ReturnType<typeof print>['map'];
	css: string;
}

interface TransformState {
	scope: Scope;
	analysis: AnalysisResult;
	/** Current component info (null at module level) */
	component: ComponentInfo | null;
	/** Scope attrs from CSS scoping for the current component */
	scopeAttrs: string[];
	/** Processed styles with scope path info */
	processedStyles: ProcessedStyle[];
	/** Current element path in the JSX tree (for nested CSS scoping) */
	elementPath: number[];
	/** CSS vars for the current component */
	cssVars: CSSVar[];
	/** Reactive call targets */
	reactiveCallTargets: Map<string, Set<number>>;
	/** Current XML namespace context */
	nsContext: 'html' | 'svg' | 'math';
	/** Filename for CSS scoping */
	filename: string;
	/** Collected CSS fragments */
	cssFragments: string[];
	/** Whether to emit $.style() calls */
	emitStyleCalls: boolean;
	/** Whether we're inside a derived/effect callback body */
	insideDerived: boolean;
}

// ── Main entry ─────────────────────────────────────────────────────

export function transform(
	analysis: AnalysisResult,
	filename?: string,
	cssMode?: 'injected' | 'external',
): TransformResult {
	const cssFragments: string[] = [];
	const emitStyleCalls = cssMode !== 'external';

	const initialState: TransformState = {
		scope: analysis.scope,
		analysis,
		component: null,
		scopeAttrs: [],
		processedStyles: [],
		elementPath: [],
		cssVars: [],
		reactiveCallTargets: analysis.reactiveCallTargets,
		nsContext: 'html',
		filename: filename || 'input.tsx',
		cssFragments,
		emitStyleCalls,
		insideDerived: false,
	};

	derivedDestructureCounter = 0;

	const transformed = walk<AstNode, TransformState>(analysis.ast, initialState, {
		...visitors,

		Program(node, { state, visit }) {
			const body: AstNode[] = [];
			let needsRuntime = false;

			if (state.analysis.components.size > 0 || hasModuleReactiveDecls(state.analysis) || hasModuleLevelJsx(node, state.analysis)) {
				needsRuntime = true;
			}

			if (needsRuntime) {
				body.push(b.importDefault('$', 'dartsx/internal/client'));
			}

			for (const stmt of node.body) {
				// Skip dartsx internal imports
				if (stmt.type === 'ImportDeclaration') {
					const src = stmt.source.value;
					if (src.startsWith('dartsx/internal')) continue;
					body.push(stmt);
					continue;
				}

				// Component function declaration
				const compInfo = state.analysis.components.get(stmt);
				if (compInfo) {
					body.push(transformComponent(stmt, compInfo, state, state.filename, state.cssFragments, state.emitStyleCalls));
					continue;
				}

				// Transform regular statements
				body.push(visit(stmt, state));
			}

			return b.program(body);
		},
	});

	const printOpts: PrintOptions = {};
	if (analysis.source && filename) {
		printOpts.sourceMapContent = analysis.source;
		printOpts.sourceMapSource = filename;
	}
	const { code, map } = print(transformed, tsx(), printOpts);
	return { code, map, css: cssFragments.join('\n') };
}

// ── Component transform ────────────────────────────────────────────

function extractFnNode(node: AstNode): OxcFunction | null {
	if (node.type === 'FunctionDeclaration') return node;
	if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration') return node.declaration;
	if (node.type === 'ExportDefaultDeclaration' && node.declaration.type === 'FunctionDeclaration') return node.declaration;
	return null;
}

function transformComponent(
	outerNode: AstNode,
	compInfo: ComponentInfo,
	parentState: TransformState,
	filename: string | undefined,
	cssFragments: string[],
	emitStyleCalls: boolean,
) {
	const { meta, styleBlocks, renamedParams, scope: compScope } = compInfo;

	// Process scoped CSS
	const processedStyles = processStyles(styleBlocks, meta.name, filename || 'input.tsx');
	const scopeAttrs = processedStyles.filter(s => s.attr).map(s => s.attr);
	const allCssVars = processedStyles.flatMap(s => s.cssVars);
	for (const ps of processedStyles) cssFragments.push(ps.css);

	// Get the function node — unwrap export wrappers
	const fnNode = extractFnNode(outerNode);
	if (!fnNode) return outerNode;

	const hasProps = fnNode.params.length > 0;
	const isNested = compScope.parent !== parentState.analysis.scope;
	const propsName = isNested ? '$props' : '$$props';

	const stmts: AstNode[] = [];

	// Emit $.style() calls
	if (emitStyleCalls) {
		for (const ps of processedStyles) {
			stmts.push(b.exprStmt(b.call('$.style', [b.literal(ps.hash), b.literal(ps.css)])));
		}
	}

	// Emit prop declarations
	if (hasProps) {
		const firstParam = fnNode.params[0];
		if (firstParam && firstParam.type === 'ObjectPattern') {
			// New format: ObjectPattern destructuring
			const bindParamNames = new Set(compInfo.bindParams || []);
			for (const prop of firstParam.properties) {
				if (prop.type === 'RestElement') {
					const name = prop.argument.type === 'Identifier' ? prop.argument.name : 'rest';
					stmts.push(b.letDecl(name, b.id(propsName)));
					continue;
				}
				// Property — get local name and default value
				let localName: string | undefined;
				let defaultValue: AstNode | null = null;
				if (prop.value.type === 'Identifier') {
					localName = prop.value.name;
				} else if (prop.value.type === 'AssignmentPattern' && prop.value.left.type === 'Identifier') {
					localName = prop.value.left.name;
					defaultValue = prop.value.right;
				}
				if (!localName) continue;

				const externalName = renamedParams[localName] || localName;
				const isBind = bindParamNames.has(localName);

				if (isBind) {
					const args: AstNode[] = [b.id(propsName), b.literal(externalName)];
					if (defaultValue) args.push(defaultValue);
					stmts.push(b.letDecl(localName, b.call('$.prop.bind', args)));
				} else {
					const args: AstNode[] = [b.id(propsName), b.literal(externalName)];
					if (defaultValue) args.push(defaultValue);
					stmts.push(b.constDecl(localName, b.call('$.prop', args)));
				}
			}
		}
	}

	// Create component state
	const compState: TransformState = {
		...parentState,
		scope: compScope,
		component: compInfo,
		scopeAttrs,
		processedStyles,
		elementPath: [],
		cssVars: allCssVars,
	};

	// Walk body statements
	if (!fnNode.body) return outerNode;
	for (const stmt of fnNode.body.body) {
		if (stmt.type === 'ReturnStatement' && stmt.argument) {
			let jsxNode: Expression = stmt.argument;
			while (jsxNode.type === 'ParenthesizedExpression') jsxNode = jsxNode.expression;
			if (jsxNode.type === 'JSXElement' || jsxNode.type === 'JSXFragment') {
				const jsxExpr = walkNode(jsxNode, compState);
				stmts.push(b.returnStmt(jsxExpr));
				continue;
			}
			// Non-JSX render expression: wrap in thunk if reactive
			const transformed = walkNode(stmt.argument, compState);
			if (expressionIsReactive(stmt.argument, compState)) {
				stmts.push(b.returnStmt(b.arrow([], transformed)));
			} else {
				stmts.push(b.returnStmt(transformed));
			}
			continue;
		}
		if (stmt.type === 'VariableDeclaration') {
			const transformed = transformVariableDeclaration(stmt, compState, () => walkNode(stmt, compState));
			if (transformed) stmts.push(transformed);
			continue;
		}
		stmts.push(walkNode(stmt, compState));
	}

	// Build the function
	const params = hasProps ? [b.id(propsName)] : [];
	const funcDecl = b.func(meta.name, params, stmts, meta.isAsync);

	if (meta.isExport && meta.isDefault) return b.exportDefault(funcDecl);
	if (meta.isExport) return b.exportNamed(funcDecl);
	return funcDecl;
}

// ── Shared visitors ────────────────────────────────────────────────

const visitors = {
	_(node: AstNode, { next, state: s }: { next: WalkContext['next']; state: TransformState }) {
		const scope = s.analysis.scopes.get(node);
		if (scope && scope !== s.scope) {
			next({ ...s, scope });
		} else {
			next();
		}
	},
	FunctionDeclaration(node: AstNode, { state: s, next }: { state: TransformState; next: WalkContext['next'] }) {
		const compInfo = s.analysis.components.get(node);
		if (compInfo) {
			return transformComponent(node, compInfo, s, s.filename, s.cssFragments, s.emitStyleCalls);
		}
		return next();
	},
	VariableDeclaration(node: VariableDeclaration, { state: s, next }: { state: TransformState; next: WalkContext['next'] }) {
		return transformVariableDeclaration(node, s, next);
	},
	Identifier(node: AstNode, { state: s, path }: { state: TransformState; path: AstNode[] }) {
		return transformIdentifier(node, s, path);
	},
	Property(node: AstNode, { state: s, next }: { state: TransformState; next: WalkContext['next'] }) {
		if (node.type !== 'Property') return next();
		return transformShorthandProperty(node, s, next);
	},
	AssignmentExpression(node: AssignmentExpression, { state: s, visit }: { state: TransformState; visit: WalkContext['visit'] }) {
		return transformAssignment(node, s, visit);
	},
	UpdateExpression(node: UpdateExpression, { state: s }: { state: TransformState }) {
		return transformUpdate(node, s);
	},
	JSXElement(node: JSXElement, { state: s, visit }: { state: TransformState; visit: WalkContext['visit'] }) {
		return transformJSXElement(node, s, visit);
	},
	JSXFragment(node: JSXFragment, { state: s, visit }: { state: TransformState; visit: WalkContext['visit'] }) {
		const children = transformJSXChildren(node.children, s, visit, true);
		if (children.length === 0) return b.literal(null);
		if (children.length === 1) return children[0];
		return b.call('$.jsx', [
			b.member('$.Fragment'),
			b.object([b.prop('children', b.array(children))]),
		]);
	},
	CallExpression(node: CallExpression, { state: s, next }: { state: TransformState; next: WalkContext['next'] }) {
		if (node.callee.type !== 'Identifier') {
			if (isControlFlowIIFE(node)) return transformIIFE(node, s);
			return next();
		}
		const fn = node.callee.name;
		if (fn === '__try') return transformTryCall(node, s);
		if (fn === '__html') return transformHtmlCall(node, s);
		return transformReactiveCallOrNext(node, s, next);
	},
	JSXExpressionContainer(node: JSXExpressionContainer, { state: s, visit }: { state: TransformState; visit: WalkContext['visit'] }) {
		return visit(node.expression, s);
	},
};

function walkNode(node: AstNode, state: TransformState): AstNode {
	return walk<AstNode, TransformState>(node, state, visitors);
}

// ── Shared transform functions ─────────────────────────────────────

function transformVariableDeclaration(node: VariableDeclaration, state: TransformState, next: WalkContext['next']) {
	const newDeclarators: typeof node.declarations = [];
	let changed = false;
	let prevMarker: string | null = null;

	for (const decl of node.declarations) {
		if (decl.id.type !== 'Identifier') {
			// Derived destructuring: pattern follows a $$d marker
			if (prevMarker?.startsWith(DERIVED_MARKER) && (decl.id.type === 'ObjectPattern' || decl.id.type === 'ArrayPattern')) {
				changed = true;
				const derivedState = { ...state, insideDerived: true };
				const initExpr = decl.init ? walkNode(decl.init, derivedState) : b.id('undefined');
				// Lower destructuring: create temp + individual $.derived() per binding
				lowerDerivedDestructuring(decl.id, initExpr, newDeclarators, state);
			} else {
				newDeclarators.push(decl);
			}
			prevMarker = null;
			continue;
		}
		const name = decl.id.name;

		// Skip $$s*/$$d* marker declarators (emitted by preprocess)
		if (name.startsWith(STATE_MARKER) || name.startsWith(DERIVED_MARKER)) {
			changed = true;
			prevMarker = name;
			continue;
		}
		prevMarker = null;

		const binding = state.scope.get(name);
		if (!binding) {
			newDeclarators.push(decl);
			continue;
		}

		if (binding.kind === 'state') {
			changed = true;
			const initExpr = decl.init ? walkNode(decl.init, state) : undefined;
			const args = initExpr ? [initExpr] : [];
			newDeclarators.push(b.declarator(b.id(name), b.call('$.state', args)));
			continue;
		}

		if (binding.kind === 'derived') {
			changed = true;
			const derivedState = { ...state, insideDerived: true };
			const initExpr = decl.init ? walkNode(decl.init, derivedState) : b.id('undefined');

			// Detect IIFE pattern: (() => { ... })() → unwrap to block body
			if (initExpr.type === 'CallExpression') {
				const iifeCallee = initExpr.callee.type === 'ParenthesizedExpression' ? initExpr.callee.expression : initExpr.callee;
				if ((iifeCallee.type === 'ArrowFunctionExpression' || iifeCallee.type === 'FunctionExpression') &&
					initExpr.arguments.length === 0 &&
					iifeCallee.body &&
					iifeCallee.body.type === 'BlockStatement') {
					const stmtsBlock = iifeCallee.body;
					newDeclarators.push(b.declarator(b.id(name), b.call('$.derived', [b.arrowBlock([], stmtsBlock.body)])));
					continue;
				}
			}

			const body = isObjectLiteral(initExpr)
				? b.sequence([initExpr])
				: initExpr;
			newDeclarators.push(b.declarator(b.id(name), b.call('$.derived', [b.arrow([], body)])));
			continue;
		}

		newDeclarators.push(decl);
	}

	if (changed) {
		return { ...node, declarations: newDeclarators };
	}
	return next();
}

let derivedDestructureCounter = 0;

function lowerDerivedDestructuring(pattern: AstNode, initExpr: AstNode, out: AstNode[], state: TransformState): void {
	// Create a temp variable for the source expression
	const tempName = `__destructured_${derivedDestructureCounter++}`;
	out.push(b.declarator(b.id(tempName), initExpr));

	// Walk the pattern and create individual $.derived() bindings
	emitDerivedBindings(pattern, b.id(tempName), out);
}

function memberComputed(obj: AstNode, index: number): AstNode {
	return b.computedMember(obj, b.literal(index));
}

function memberDot(obj: AstNode, prop: string): AstNode {
	return b.staticMember(obj, prop);
}

function sliceCall(obj: AstNode, from: number): AstNode {
	return b.call(memberDot(obj, 'slice'), [b.literal(from)]);
}

function emitDerivedBindings(pattern: AstNode, baseExpr: AstNode, out: AstNode[]): void {
	if (pattern.type === 'ObjectPattern') {
		for (const prop of pattern.properties) {
			if (prop.type === 'RestElement') {
				if (prop.argument.type === 'Identifier') {
					// ...rest — use object spread minus other keys
					const otherKeys = pattern.properties
						.filter((p): p is BindingProperty => p.type === 'Property')
						.map((p) => {
							if (p.key.type === 'Identifier') return p.key.name;
							if (p.key.type === 'Literal' && typeof p.key.value === 'string') return p.key.value;
							return null;
						})
						.filter((k): k is string => k !== null);
					// Build: (({ key1, key2, ...rest }) => rest)(baseExpr)
					const restExpr = buildObjectRest(baseExpr, otherKeys, prop.argument.name);
					out.push(b.declarator(b.id(prop.argument.name), b.call('$.derived', [b.arrow([], restExpr)])));
				}
				continue;
			}
			const key = prop.key.type === 'Identifier' ? prop.key.name : (prop.key.type === 'Literal' && typeof prop.key.value === 'string' ? prop.key.value : null);
			if (!key) continue;
			const accessExpr = memberDot(baseExpr, key);
			const value = prop.value;
			if (value.type === 'Identifier') {
				out.push(b.declarator(b.id(value.name), b.call('$.derived', [b.arrow([], accessExpr)])));
			} else if (value.type === 'AssignmentPattern' && value.left.type === 'Identifier') {
				// { a = defaultVal }
				const name = value.left.name;
				const cond = b.binary('!==', accessExpr, b.id('undefined'));
				const ternary = b.conditional(cond, accessExpr, value.right);
				out.push(b.declarator(b.id(name), b.call('$.derived', [b.arrow([], ternary)])));
			} else if (value.type === 'ObjectPattern' || value.type === 'ArrayPattern') {
				emitDerivedBindings(value, accessExpr, out);
			}
		}
	} else if (pattern.type === 'ArrayPattern') {
		for (let i = 0; i < pattern.elements.length; i++) {
			const elem = pattern.elements[i];
			if (!elem) continue;
			if (elem.type === 'RestElement' && elem.argument.type === 'Identifier') {
				out.push(b.declarator(b.id(elem.argument.name), b.call('$.derived', [b.arrow([], sliceCall(baseExpr, i))])));
				continue;
			}
			const accessExpr = memberComputed(baseExpr, i);
			if (elem.type === 'Identifier') {
				out.push(b.declarator(b.id(elem.name), b.call('$.derived', [b.arrow([], accessExpr)])));
			} else if (elem.type === 'AssignmentPattern' && elem.left.type === 'Identifier') {
				const name = elem.left.name;
				const cond = b.binary('!==', accessExpr, b.id('undefined'));
				const ternary = b.conditional(cond, accessExpr, elem.right);
				out.push(b.declarator(b.id(name), b.call('$.derived', [b.arrow([], ternary)])));
			} else if (elem.type === 'ObjectPattern' || elem.type === 'ArrayPattern') {
				emitDerivedBindings(elem, accessExpr, out);
			}
		}
	}
}

function buildObjectRest(baseExpr: AstNode, excludeKeys: string[], restName: string): AstNode {
	// Build: (({ key1, key2, ...rest }) => rest)(baseExpr)
	const restId = b.id(restName);
	const props: AstNode[] = excludeKeys.map(k => b.shorthandProp(k));
	props.push(b.restElement(restId));
	const param = b.objectPattern(props);
	const arrowExpr = b.arrow([param], restId);
	return b.call(b.paren(arrowExpr), [baseExpr]);
}

function transformShorthandProperty(node: Extract<AstNode, { type: 'Property' }>, state: TransformState, next: WalkContext['next']) {
	if (!node.shorthand) return next();
	const key = node.key;
	if (key.type !== 'Identifier') return next();
	const binding = state.scope.get(key.name);
	if (!binding?.reactive) return next();

	if (state.insideDerived) {
		// Inside derived/thunk callbacks: eager $.get() value
		return b.prop(key.name, b.call('$.get', [b.id(key.name)]));
	}

	// General case: convert to getter so the read is lazy
	return b.getter(key.name, [b.returnStmt(b.call('$.get', [b.id(key.name)]))]);
}

function transformIdentifier(node: AstNode, state: TransformState, path: AstNode[]) {
	if (node.type !== 'Identifier') return;
	const binding = state.scope.get(node.name);
	if (!binding?.reactive) return;

	const parent = path.at(-1);

	// Root node in a walkNode() call — no parent context, apply $.get()
	if (!parent) return b.call('$.get', [node]);

	// Skip positions where the identifier is being declared/written, not read
	if (parent.type === 'AssignmentExpression' && parent.left === node) return;
	if (parent.type === 'UpdateExpression') return;
	if (parent.type === 'VariableDeclarator' && parent.id === node) return;
	if (parent.type === 'FunctionDeclaration' && parent.id === node) return;
	if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier') return;
	if (parent.type === 'RestElement') return;
	if ((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' || parent.type === 'ArrowFunctionExpression') &&
		parent.params.some(p => p.type === 'Identifier' && p.name === node.name)) return;

	// Skip non-computed property keys (e.g. { count: ... } or obj.count)
	if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
	if (parent.type === 'Property' && parent.key === node && !parent.computed) return;

	// Proxy/derived/bind-prop: direct member access (obj.foo) or direct call (fn()), no $.get() on the root
	if (parent.type === 'MemberExpression' && parent.object === node && binding.directMemberAccess) return;
	if (parent.type === 'CallExpression' && parent.callee === node && binding.directMemberAccess) return;

	// Signal forwarding: don't unwrap when passing to a reactive-param function
	if (isInReactiveCallArg(node, path, state.reactiveCallTargets)) return;

	// Shorthand properties handled by the Property visitor
	if (parent.type === 'Property' && parent.shorthand && parent.value === node) return;

	// Derived signals returned from non-component functions stay as signals
	if (parent.type === 'ReturnStatement' && parent.argument === node &&
		binding.kind === 'derived' && !state.component) return;

	return b.call('$.get', [node]);
}

function transformAssignment(node: AssignmentExpression, state: TransformState, visit: WalkContext['visit']) {
	const left = node.left;
	if (left.type !== 'Identifier') return;

	const binding = state.scope.get(left.name);
	if (!binding?.writable) return;

	const transformedRight = visit(node.right, state);
	const value = node.operator === '='
		? transformedRight
		: b.binary(node.operator.slice(0, -1), b.call('$.get', [left]), transformedRight);
	return b.call('$.set', [b.id(left.name), value]);
}

function transformUpdate(node: UpdateExpression, state: TransformState) {
	const arg = node.argument;
	if (arg.type !== 'Identifier') return;

	const binding = state.scope.get(arg.name);
	if (!binding?.writable) return;

	const op = node.operator === '++' ? '+' : '-';
	return b.call('$.set', [b.id(arg.name), b.binary(op, b.call('$.get', [arg]), b.literal(1))]);
}

/**
 * Handle calls to functions in reactiveCallTargets.
 * Member expression args at reactive positions get wrapped in $.derived().
 * Array deps: each element is individually checked.
 * Falls through to next() for non-reactive calls.
 */
function transformReactiveCallOrNext(node: CallExpression, state: TransformState, next: WalkContext['next']) {
	if (node.callee.type !== 'Identifier') return next();
	const fn = node.callee.name;

	const reactiveIndices = state.reactiveCallTargets.get(fn);
	if (!reactiveIndices || reactiveIndices.size === 0) return next();

	// Let next() do the default traversal first, then fix up reactive arg positions
	const result = next();
	const transformed = result ?? node;
	if (transformed.type !== 'CallExpression') return result;

	// Now wrap member expression args at reactive positions in $.derived()
	const args = [...transformed.arguments];
	let changed = false;

	for (const idx of reactiveIndices) {
		if (idx >= args.length) continue;
		const arg = args[idx];
		const original = node.arguments[idx];

		if (original && original.type === 'ArrayExpression') {
			// Array of deps: wrap each member expression element
			const transformedArg = args[idx];
			if (transformedArg.type !== 'ArrayExpression') continue;
			const newElements: AstNode[] = transformedArg.elements.map((el, i) => {
				const origEl = original.elements[i];
				if (el && origEl && origEl.type === 'MemberExpression' && isMemberOnReactive(origEl, state)) {
					changed = true;
					return b.call('$.derived', [b.arrow([], el)]);
				}
				return el ?? b.literal(null);
			});
			if (changed) args[idx] = b.array(newElements);
		} else if (original && original.type === 'MemberExpression' && isMemberOnReactive(original, state)) {
			// Single member expression dep
			args[idx] = b.call('$.derived', [b.arrow([], arg)]);
			changed = true;
		}
	}

	if (changed) {
		return { ...transformed, arguments: args };
	}
	return result;
}

/** Check if the root of a member expression chain is a callback/for-loop parameter */
function memberRootIsCallbackParam(expr: Expression, state: TransformState): boolean {
	let node: Expression = expr;
	while (node.type === 'MemberExpression') node = node.object;
	if (node.type !== 'Identifier') return false;
	const binding = state.scope.get(node.name);
	if (!binding) return false;
	// If declared in a scope that's a child of the component scope, it's a callback param
	return binding.scope !== state.component?.scope && binding.kind === 'normal';
}

/** Check if a member expression's root object is a reactive binding */
function isMemberOnReactive(node: Expression, state: TransformState): boolean {
	if (node.type === 'Identifier') {
		const binding = state.scope.get(node.name);
		return !!binding?.reactive;
	}
	if (node.type === 'MemberExpression') return isMemberOnReactive(node.object, state);
	return false;
}

// ── JSX transform ──────────────────────────────────────────────────

function transformJSXElement(node: JSXElement, state: TransformState, visit: WalkContext['visit']) {
	const opening = node.openingElement;
	const tagName = getTagName(opening.name);

	// Skip style marker elements
	if (tagName.startsWith(STYLE_MARKER_PREFIX)) return b.literal(null);

	const isComponent = /^[A-Z]/.test(tagName);

	const props: AstNode[] = [];

	const selfNs = isComponent ? 'html'
		: tagName === 'svg' || tagName === 'foreignObject' ? 'svg'
			: tagName === 'math' ? 'math' : state.nsContext;
	const childNs = isComponent ? state.nsContext
		: tagName === 'foreignObject' ? 'html' : selfNs;

	for (const attr of opening.attributes) {
		if (attr.type === 'JSXSpreadAttribute') {
			props.push(b.spread(walkNode(attr.argument, state)));
			continue;
		}
		const attrResult = transformJSXAttribute(attr, state);
		if (attrResult) {
			if (Array.isArray(attrResult)) {
				props.push(...attrResult);
			} else {
				props.push(attrResult);
			}
		}
	}

	// Add scope attrs for scoped CSS
	if (!isComponent && state.processedStyles.length > 0) {
		const attrs = computeScopeAttrsForElement(state.processedStyles, state.elementPath);
		if (attrs.length > 0) {
			props.push(b.prop(SCOPE_ATTR, b.literal(attrs.join(' '))));
		}
	} else if (!isComponent && state.scopeAttrs.length > 0) {
		props.push(b.prop(SCOPE_ATTR, b.literal(state.scopeAttrs.join(' '))));
	}

	// Add CSS vars style prop on the root element
	if (!isComponent && state.cssVars.length > 0) {
		const parseCSSVarExpr = (exprStr: string): Expression | null => {
			const parsed = parseSync('x.ts', `(${exprStr})`, { sourceType: 'module' });
			const firstStmt = parsed.program.body[0];
			if (!firstStmt || firstStmt.type !== 'ExpressionStatement') return null;
			let expr: Expression = firstStmt.expression;
			while (expr.type === 'ParenthesizedExpression') expr = expr.expression;
			return expr;
		};
		const styleProps = state.cssVars.map((cv) => {
			let valueExpr: AstNode = b.id(cv.expr);
			const parsed = parseCSSVarExpr(cv.expr);
			if (parsed) {
				valueExpr = walkNode(parsed, state);
			}
			// If there's a suffix (e.g. "px"), add string concatenation
			if (cv.suffix) {
				valueExpr = b.binary('+', valueExpr, b.literal(cv.suffix));
			}
			return b.prop(cv.varName, valueExpr);
		});
		const styleObj = b.object(styleProps);
		// Check if any expression references reactive state
		const isReactive = state.cssVars.some((cv) => {
			const expr = parseCSSVarExpr(cv.expr);
			return expr ? expressionIsReactive(expr, state) : false;
		});
		props.push(isReactive ? b.getter('style', [b.returnStmt(styleObj)]) : b.prop('style', styleObj));
	}

	// Process children
	if (!opening.selfClosing) {
		const childState: TransformState = { ...state, nsContext: childNs };
		const children = transformJSXChildren(node.children, childState, visit, true);
		if (children.length > 0) {
			props.push(b.prop('children', b.array(children)));
		}
	}

	const tag = isComponent ? b.id(tagName) : b.literal(tagName);
	const factory = selfNs === 'svg' ? '$.svg' : selfNs === 'math' ? '$.math' : '$.jsx';
	if (props.length === 0) return b.call(factory, [tag]);

	// If there are spread elements, use $.mergeProps() to preserve getters
	const hasSpread = props.some(p => p.type === 'SpreadElement');
	if (hasSpread) {
		const sources = buildMergeSources(props);
		return b.call(factory, [tag, b.call('$.mergeProps', sources)]);
	}
	return b.call(factory, [tag, b.object(props)]);
}

/**
 * Split a props array (which may contain SpreadElements) into merge sources.
 * Consecutive non-spread props become a single object literal.
 * Spread elements become their argument directly.
 *
 * [prop1, spread(x), prop2, prop3] → [{ prop1 }, x, { prop2, prop3 }]
 */
function buildMergeSources(props: AstNode[]): AstNode[] {
	const sources: AstNode[] = [];
	let current: AstNode[] = [];

	for (const prop of props) {
		if (prop.type === 'SpreadElement') {
			if (current.length > 0) {
				sources.push(b.object(current));
				current = [];
			}
			sources.push(prop.argument);
		} else {
			current.push(prop);
		}
	}
	if (current.length > 0) {
		sources.push(b.object(current));
	}
	return sources;
}

function transformJSXAttribute(attr: JSXAttribute, state: TransformState) {
	const attrName = getAttrName(attr.name);

	// Namespace: bind:value
	if (attr.name.type === 'JSXNamespacedName') {
		const ns = attr.name.namespace.name;
		const local = attr.name.name.name;

		if (ns === 'bind') {
			const expr = attr.value?.type === 'JSXExpressionContainer' ? attr.value.expression : null;
			if (expr && expr.type !== 'JSXEmptyExpression' && expr.type === 'ArrayExpression' && expr.elements.length === 2) {
				const el0 = expr.elements[0];
				const el1 = expr.elements[1];
				if (el0 && el1) {
					const result = [
						buildBindGetter(local, walkNode(el0, state)),
						buildBindSetter(local, walkNode(el1, state)),
					].filter((n): n is AstNode => n !== null);
					return result;
				}
			}
			if (expr && expr.type !== 'JSXEmptyExpression') {
				let getExpr: AstNode;
				let setBody: AstNode;
				if (expr.type === 'Identifier') {
					const binding = state.scope.get(expr.name);
					if (binding?.writable) {
						getExpr = b.call('$.get', [b.id(expr.name)]);
						setBody = b.exprStmt(b.call('$.set', [b.id(expr.name), b.id('v')]));
					} else {
						getExpr = walkNode(expr, state);
						setBody = b.exprStmt(b.assignment('=', b.id(expr.name), b.id('v')));
					}
				} else {
					getExpr = walkNode(expr, state);
					setBody = b.exprStmt(b.assignment('=', walkNode(expr, state), b.id('v')));
				}
				return [
					b.getter(local, [b.returnStmt(getExpr)]),
					b.setter(local, b.id('v'), [setBody])
				];
			}
			return null;
		}
	}

	// Boolean: disabled
	if (attr.value === null && attr.name.type === 'JSXIdentifier') {
		return b.prop(attrName, b.literal(true));
	}

	// Static string
	if (attr.value?.type === 'Literal') {
		return b.prop(attrName, b.literal(attr.value.value));
	}

	// Dynamic: {expr}
	if (attr.value?.type === 'JSXExpressionContainer') {
		const expr = attr.value.expression;
		if (expr.type === 'JSXEmptyExpression') return null;

		const isReactive = expressionIsReactive(expr, state);

		if (isReactive) {
			// Use a getter so reactive props are lazily evaluated.
			// Walk with insideDerived so shorthand properties use eager $.get()
			// instead of nested getters.
			const transformed = walkNode(expr, { ...state, insideDerived: true });
			return b.getter(attrName, [b.returnStmt(transformed)]);
		}
		const transformed = walkNode(expr, state);
		return b.prop(attrName, transformed);
	}

	return b.prop(attrName, b.literal(null));
}


function transformJSXChildren(children: ReadonlyArray<JSXChild>, state: TransformState, visit: WalkContext['visit'], trackElementPath = false): AstNode[] {
	const result: AstNode[] = [];
	let elementIdx = 0;

	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		const isFirst = i === 0;
		const isLast = i === children.length - 1;

		if (child.type === 'JSXText') {
			const text = normalizeJSXText(child.value, isFirst, isLast);
			if (text.length === 0) continue;
			if (text.trim().length === 0) {
				// Drop whitespace-only text nodes around elements and control flow
				const prev = i > 0 ? children[i - 1] : null;
				const next = i < children.length - 1 ? children[i + 1] : null;
				const prevIsElement = prev?.type === 'JSXElement';
				const nextIsElement = next?.type === 'JSXElement';
				const isControlFlow = (n: JSXChild | null) => {
					if (n?.type !== 'JSXExpressionContainer') return false;
					const e = n.expression;
					if (e.type === 'CallExpression') {
						if (e.callee.type === 'Identifier' && ['__try', '__html'].includes(e.callee.name)) return true;
						if (isControlFlowIIFE(e)) return true;
						if (isBlockIIFE(e)) return true;
					}
					return false;
				};
				// Drop whitespace between element and control flow, or between two elements
				if ((prevIsElement && nextIsElement) ||
					(prevIsElement && isControlFlow(next)) ||
					(isControlFlow(prev) && nextIsElement) ||
					(isControlFlow(prev) && isControlFlow(next)) ||
					isFirst || isLast) {
					continue;
				}
			}
			result.push(b.literal(text));
			continue;
		}

		if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
			// Skip style marker elements (e.g. <$$style0 />)
			if (child.type === 'JSXElement') {
				const name = getTagName(child.openingElement.name);
				if (name.startsWith(STYLE_MARKER_PREFIX)) continue;
			}
			const childElementState = trackElementPath
				? { ...state, elementPath: [...state.elementPath, elementIdx] }
				: state;
			result.push(walkNode(child, childElementState));
			elementIdx++;
			continue;
		}

		if (child.type === 'JSXExpressionContainer') {
			const expr = child.expression;
			if (expr.type === 'JSXEmptyExpression') continue;

			// Control flow calls (__try, __html)
			if (expr.type === 'CallExpression' && expr.callee.type === 'Identifier') {
				const fn = expr.callee.name;
				if (fn === '__try' || fn === '__html') {
					result.push(walkNode(expr, state));
					continue;
				}
			}

			// IIFE control flow: (() => { if/for/switch ... })()
			if (isControlFlowIIFE(expr)) {
				result.push(transformIIFE(expr, state));
				continue;
			}

			// Block IIFE: (() => { const x = ...; ... })()
			if (isBlockIIFE(expr)) {
				result.push(transformBlockIIFECall(expr, state));
				continue;
			}

			// Nested JSX
			if (expr.type === 'JSXElement' || expr.type === 'JSXFragment') {
				result.push(walkNode(expr, state));
				continue;
			}

			// Ternary: cond ? <jsx/> : <jsx/>
			if (expr.type === 'ConditionalExpression') {
				if (isJSXExpr(expr.consequent) && (isJSXExpr(expr.alternate) || isNullish(expr.alternate))) {
					result.push(transformTernaryToIf(expr, state));
					continue;
				}
			}

			// Logical &&
			if (expr.type === 'LogicalExpression' && expr.operator === '&&' && isJSXExpr(expr.right)) {
				result.push(transformLogicalAndToIf(expr, state));
				continue;
			}

			// Regular expression child
			const transformed = walkNode(expr, state);
			const shouldThunk = expressionIsReactive(expr, state)
				|| (expr.type === 'MemberExpression' && !memberRootIsCallbackParam(expr, state));
			if (shouldThunk) {
				result.push(b.arrow([], transformed));
			} else {
				result.push(transformed);
			}
			continue;
		}

		result.push(walkNode(child, state));
	}

	return result;
}

// ── Control flow transforms ────────────────────────────────────────

// ── IIFE detection & transformation ────────────────────────────────

interface IIFEParts {
	callee: ArrowFunctionExpression;
	body: AstNode[];
}

/** Extract the arrow and block body from a zero-arg IIFE, or null */
function extractIIFE(node: AstNode): IIFEParts | null {
	if (node.type !== 'CallExpression') return null;
	if (node.arguments.length !== 0) return null;
	const callee = unwrapParen(node.callee);
	if (callee.type !== 'ArrowFunctionExpression') return null;
	if (callee.params.length !== 0) return null;
	if (callee.body.type !== 'BlockStatement') return null;
	const body = callee.body.body;
	if (body.length === 0) return null;
	return { callee, body };
}

/**
 * Detect an IIFE that wraps control flow:
 * - (() => { if/for/switch ... })()
 */
function isControlFlowIIFE(node: AstNode): boolean {
	const parts = extractIIFE(node);
	if (!parts) return false;
	const first = parts.body[0];
	return first.type === 'IfStatement' || first.type === 'ForOfStatement' ||
		first.type === 'ForInStatement' || first.type === 'ForStatement' ||
		first.type === 'SwitchStatement';
}

/**
 * Detect a block IIFE: (() => { const/let/var ...; ... })()
 */
function isBlockIIFE(node: AstNode): boolean {
	const parts = extractIIFE(node);
	if (!parts) return false;
	return parts.body[0].type === 'VariableDeclaration';
}

/**
 * Transform an IIFE control flow expression into runtime calls.
 * Caller must have verified this is an IIFE via isControlFlowIIFE/extractIIFE.
 */
function transformIIFE(node: AstNode, state: TransformState): AstNode {
	const parts = extractIIFE(node)!;
	const { callee, body } = parts;
	const first = body[0];

	// Enter the IIFE's scope (the arrow function might have one)
	const iifeScope = state.analysis.scopes.get(callee) || state.scope;
	const iifeState = iifeScope !== state.scope ? { ...state, scope: iifeScope } : state;

	if (first.type === 'IfStatement') {
		return transformIfStatementToRuntime(first, iifeState);
	}
	if (first.type === 'ForOfStatement' || first.type === 'ForInStatement' || first.type === 'ForStatement') {
		return transformForStatementToRuntime(first, iifeState);
	}
	if (first.type === 'SwitchStatement') {
		return transformSwitchStatementToRuntime(first, iifeState);
	}

	// Block IIFE (starts with variable declaration): produce a thunk
	if (first.type === 'VariableDeclaration') {
		return transformBlockIIFE(body, iifeState);
	}

	// Fallback: walk as-is
	return walkNode(node, state);
}

/**
 * Transform a block IIFE called from JSX children context.
 * Caller must have verified this is a block IIFE via isBlockIIFE/extractIIFE.
 */
function transformBlockIIFECall(node: AstNode, state: TransformState): AstNode {
	const parts = extractIIFE(node)!;
	const { callee, body } = parts;

	const iifeScope = state.analysis.scopes.get(callee) || state.scope;
	const iifeState = iifeScope !== state.scope ? { ...state, scope: iifeScope } : state;

	return transformBlockIIFE(body, iifeState);
}

/**
 * Transform IfStatement → $.if(() => cond, () => consequent, () => alternate)
 */
function transformIfStatementToRuntime(node: IfStatement, state: TransformState): AstNode {
	const condExpr = walkNode(node.test, state);
	const condThunk = b.arrow([], condExpr);

	const thenThunk = blockToArrow(node.consequent, state);
	const resultArgs: AstNode[] = [condThunk, thenThunk];

	if (node.alternate) {
		if (node.alternate.type === 'IfStatement') {
			// else if → nested $.if
			resultArgs.push(b.arrow([], transformIfStatementToRuntime(node.alternate, state)));
		} else {
			resultArgs.push(blockToArrow(node.alternate, state));
		}
	}

	return b.call('$.if', resultArgs);
}

/**
 * Transform ForOfStatement → $.for(() => collection, (item, index) => { jsx; }, keyFn?)
 * Transform ForInStatement → $.for(() => Object.keys(collection), (key) => { jsx; })
 * Transform ForStatement (C-style) → $.for(() => { collect array }, (iterVar) => jsx)
 *
 * For-of body may contain:
 * - `let i = 0;` → index variable (injected by preprocess for-clauses)
 * - A non-JSX ExpressionStatement after index var → key expression
 * - Remaining statements → callback body (block arrow)
 */
function transformForStatementToRuntime(node: ForOfStatement | ForInStatement | ForStatement, state: TransformState): AstNode {
	// C-style for: build array collection thunk
	if (node.type === 'ForStatement') {
		return transformCStyleFor(node, state);
	}

	// Enter the for statement's scope (includes the iteration variable)
	const forScope = state.analysis.scopes.get(node) || state.analysis.scopes.get(node.body) || state.scope;
	const forState = forScope !== state.scope ? { ...state, scope: forScope } : state;

	let collectionExpr: AstNode;
	let iterVarName = 'item';

	if (node.type === 'ForInStatement') {
		// for-in → Object.keys(collection)
		collectionExpr = b.call('Object.keys', [walkNode(node.right, state)]);
	} else {
		collectionExpr = walkNode(node.right, state);
	}
	if (node.left.type === 'VariableDeclaration' && node.left.declarations[0]) {
		const decl = node.left.declarations[0];
		if (decl.id.type === 'Identifier') iterVarName = decl.id.name;
	}

	// Extract index var, key expr, and body from the for-body
	let indexVarName: string | undefined;
	let keyExpr: AstNode | undefined;
	const bodyStmts: AstNode[] = [];

	if (node.body.type === 'BlockStatement') {
		const stmts = node.body.body;
		let foundBody = false;
		for (const stmt of stmts) {
			if (!foundBody && stmt.type === 'VariableDeclaration') {
				// `let i = 0;` → index variable (from preprocess for-clauses)
				const decl = stmt.declarations[0];
				if (decl && decl.id.type === 'Identifier' && decl.init &&
					decl.init.type === 'Literal' && decl.init.value === 0) {
					indexVarName = decl.id.name;
					continue;
				}
			}
			if (!foundBody && !keyExpr && stmt.type === 'ExpressionStatement' &&
				!isJSXExpression(stmt.expression)) {
				// Non-JSX expression statement before body → key expression
				keyExpr = walkNode(stmt.expression, forState);
				continue;
			}
			foundBody = true;
			bodyStmts.push(stmt);
		}
	}

	// Build callback — always block arrow for block bodies, expression arrow for braceless
	const collThunk = b.arrow([], collectionExpr);
	const params: AstNode[] = [b.id(iterVarName)];
	if (indexVarName) params.push(b.id(indexVarName));

	let bodyCallback: AstNode;
	if (bodyStmts.length > 0) {
		const transformedStmts = bodyStmts.map(s => walkNode(s, forState));
		bodyCallback = b.arrowBlock(params, transformedStmts);
	} else if (node.body.type !== 'BlockStatement') {
		// Braceless for body — single expression
		const bodyExpr = node.body.type === 'ExpressionStatement' ? node.body.expression : node.body;
		bodyCallback = b.arrow(params, walkNode(bodyExpr, forState));
	} else {
		bodyCallback = b.arrowBlock(params, []);
	}

	const resultArgs: AstNode[] = [collThunk, bodyCallback];
	if (keyExpr) {
		const keyFn = b.arrow([b.id(iterVarName)], keyExpr);
		resultArgs.push(keyFn);
	}

	return b.call('$.for', resultArgs);
}

/** Check if an expression is JSX (JSXElement or JSXFragment) */
function isJSXExpression(expr: AstNode): boolean {
	return expr.type === 'JSXElement' || expr.type === 'JSXFragment';
}

/**
 * C-style for loop → $.for(() => { collect array }, (iterVar) => jsx)
 */
function transformCStyleFor(node: ForStatement, state: TransformState): AstNode {
	// Extract iteration variable name from init
	let iterVarName = '__i';
	if (node.init && node.init.type === 'VariableDeclaration' && node.init.declarations[0]) {
		const decl = node.init.declarations[0];
		if (decl.id.type === 'Identifier') iterVarName = decl.id.name;
	}

	// Build collection thunk: () => { const __a = []; for (init; test; update) __a.push(iterVar); return __a; }
	const arrName = '__a';
	const initStmt = node.init ? walkNode(node.init, state) : null;
	const testExpr = node.test ? walkNode(node.test, state) : b.literal(true);
	const updateExpr = node.update ? walkNode(node.update, state) : null;

	const forStmts: AstNode[] = [
		b.constDecl(arrName, b.array([])),
		b.forStmt(initStmt, testExpr, updateExpr,
			b.exprStmt(b.call(`${arrName}.push`, [b.id(iterVarName)]))),
		b.returnStmt(b.id(arrName)),
	];
	const collThunk = b.arrowBlock([], forStmts);

	// Enter for scope for body processing
	const forScope = state.analysis.scopes.get(node) || state.analysis.scopes.get(node.body) || state.scope;
	const forState = forScope !== state.scope ? { ...state, scope: forScope } : state;

	// Extract body — collect statements for block arrow callback
	const bodyStmts: AstNode[] = [];
	if (node.body.type === 'BlockStatement') {
		for (const stmt of node.body.body) {
			bodyStmts.push(walkNode(stmt, forState));
		}
	} else if (node.body.type === 'ExpressionStatement') {
		bodyStmts.push(b.exprStmt(walkNode(node.body.expression, forState)));
	}

	const bodyCallback = b.arrowBlock([b.id(iterVarName)], bodyStmts);
	return b.call('$.for', [collThunk, bodyCallback]);
}

/**
 * Transform SwitchStatement → $.switch(() => disc, [{values, fn}, ...])
 */
function transformSwitchStatementToRuntime(node: SwitchStatement, state: TransformState): AstNode {
	const discExpr = walkNode(node.discriminant, state);
	const discThunk = b.arrow([], discExpr);

	const cases: AstNode[] = [];
	let pendingValues: AstNode[] = []; // collect values for fall-through cases

	for (const switchCase of node.cases) {
		const testValue = switchCase.test ? walkNode(switchCase.test, state) : null;

		// Check if this case has a body (non-empty consequent with actual content)
		const bodyStmts = switchCase.consequent.filter(s =>
			s.type !== 'BreakStatement' && !(s.type === 'EmptyStatement'));

		if (bodyStmts.length === 0) {
			// Fall-through case: collect its value for the next case
			if (testValue) pendingValues.push(testValue);
			continue;
		}

		// Build values array (including any pending fall-through values)
		if (testValue) pendingValues.push(testValue);
		const values = pendingValues.length > 0
			? b.array(pendingValues)
			: b.literal(null); // default case
		pendingValues = [];

		// Build case function from body statements
		let caseFn: AstNode;
		if (bodyStmts.length === 1) {
			// Single statement
			const stmt = bodyStmts[0];
			if (stmt.type === 'ReturnStatement' && stmt.argument) {
				caseFn = b.arrow([], walkNode(unwrapParen(stmt.argument), state));
			} else if (stmt.type === 'ExpressionStatement' && isJSXExpression(stmt.expression)) {
				caseFn = b.arrow([], walkNode(stmt.expression, state));
			} else {
				caseFn = b.arrowBlock([], [walkNode(stmt, state)]);
			}
		} else {
			// Multi-statement → block arrow
			const transformedStmts = bodyStmts.map(s => walkNode(s, state));
			caseFn = b.arrowBlock([], transformedStmts);
		}

		cases.push(b.object([
			b.prop('values', values),
			b.prop('fn', caseFn),
		]));
	}

	return b.call('$.switch', [discThunk, b.array(cases)]);
}

/**
 * Convert a block or statement to an arrow function.
 * - Single ReturnStatement → expression arrow: () => expr
 * - Multiple statements → block arrow: () => { stmts; return expr }
 */
function blockToArrow(block: AstNode, state: TransformState): AstNode {
	if (block.type === 'BlockStatement') {
		const stmts = block.body;
		// Single return → expression arrow
		if (stmts.length === 1 && stmts[0].type === 'ReturnStatement' && stmts[0].argument) {
			return b.arrow([], walkNode(unwrapParen(stmts[0].argument), state));
		}
		// Single control flow statement → transform and wrap in expression arrow
		if (stmts.length === 1) {
			const stmt = stmts[0];
			if (stmt.type === 'IfStatement') {
				return b.arrow([], transformIfStatementToRuntime(stmt, state));
			}
			if (stmt.type === 'ForOfStatement' || stmt.type === 'ForInStatement' || stmt.type === 'ForStatement') {
				return b.arrow([], transformForStatementToRuntime(stmt, state));
			}
			if (stmt.type === 'SwitchStatement') {
				return b.arrow([], transformSwitchStatementToRuntime(stmt, state));
			}
			if (stmt.type === 'ExpressionStatement') {
				return b.arrow([], walkNode(stmt.expression, state));
			}
		}
		// Multiple statements → block arrow
		const transformedStmts: AstNode[] = [];
		for (const stmt of stmts) {
			transformedStmts.push(walkNode(stmt, state));
		}
		return b.arrowBlock([], transformedStmts);
	}
	// Single statement (shouldn't normally happen, but handle gracefully)
	if (block.type === 'ReturnStatement') {
		if (block.argument) return b.arrow([], walkNode(unwrapParen(block.argument), state));
	}
	// ExpressionStatement → unwrap to get the expression for an expression arrow
	if (block.type === 'ExpressionStatement') {
		return b.arrow([], walkNode(block.expression, state));
	}
	// Control flow statement directly
	if (block.type === 'IfStatement') {
		return b.arrow([], transformIfStatementToRuntime(block, state));
	}
	return b.arrow([], walkNode(block, state));
}

// ── Control flow call transforms ───────────────────────────────────

function transformTryCall(node: CallExpression, state: TransformState) {
	const args = node.arguments;
	const resultArgs = [transformCFCallback(args[0], state)];

	if (args[1] && !(args[1].type === 'Literal' && 'value' in args[1] && args[1].value === null)) {
		resultArgs.push(transformCFCallback(args[1], state));
	} else if (args[2]) {
		resultArgs.push(b.id('undefined'));
	}

	if (args[2]) {
		resultArgs.push(transformCFCallback(args[2], state));
	}

	return b.call('$.try', resultArgs);
}

/**
 * Transform a block IIFE (starts with variable declarations) into a thunk.
 * If the last statement is control flow, convert it to runtime calls.
 */
function transformBlockIIFE(stmts: AstNode[], state: TransformState): AstNode {
	if (stmts.length > 0) {
		const last = stmts[stmts.length - 1];
		const isControlFlow = last.type === 'IfStatement' || last.type === 'ForOfStatement' ||
			last.type === 'ForInStatement' || last.type === 'ForStatement' || last.type === 'SwitchStatement';

		if (isControlFlow) {
			// Transform: wrap control flow in return + $.if/$.for/$.switch
			const transformedStmts: AstNode[] = [];
			for (let i = 0; i < stmts.length - 1; i++) {
				transformedStmts.push(walkNode(stmts[i], state));
			}
			let cfResult: AstNode;
			if (last.type === 'IfStatement') {
				cfResult = transformIfStatementToRuntime(last, state);
			} else if (last.type === 'ForOfStatement' || last.type === 'ForInStatement' || last.type === 'ForStatement') {
				cfResult = transformForStatementToRuntime(last, state);
			} else if (last.type === 'SwitchStatement') {
				cfResult = transformSwitchStatementToRuntime(last, state);
			} else {
				cfResult = walkNode(last, state);
			}
			transformedStmts.push(b.returnStmt(cfResult));
			return b.arrowBlock([], transformedStmts);
		}
	}

	// No trailing control flow — walk all statements and produce a thunk
	const transformedStmts = stmts.map(s => walkNode(s, state));
	return b.arrowBlock([], transformedStmts);
}

function transformHtmlCall(node: CallExpression, state: TransformState) {
	const arg = node.arguments[0];
	if (!arg || arg.type === 'SpreadElement') return b.literal(null);
	const transformed = walkNode(arg, state);
	return b.call('$.html', [b.arrow([], transformed)]);
}

function transformCFCallback(arrowFn: Argument | undefined, state: TransformState): AstNode {
	if (!arrowFn || arrowFn.type !== 'ArrowFunctionExpression') return b.arrow([], b.literal(null));

	const params = arrowFn.params.map((p: ParamPattern) => {
		if (p.type === 'Identifier') return b.id(p.name);
		if (p.type === 'RestElement' && p.argument.type === 'Identifier') return b.id(p.argument.name);
		if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') return b.id(p.left.name);
		return b.id('item');
	});

	const arrowScope = state.analysis.scopes.get(arrowFn);
	const innerState = arrowScope ? { ...state, scope: arrowScope } : state;

	if (arrowFn.body.type === 'BlockStatement') {
		const transformedStmts: AstNode[] = [];
		for (const stmt of arrowFn.body.body) {
			transformedStmts.push(walkNode(stmt, innerState));
		}
		return b.arrowBlock(params, transformedStmts);
	}

	// Expression body
	return b.arrow(params, walkNode(unwrapParen(arrowFn.body), innerState));
}

// ── JSX pattern transforms ─────────────────────────────────────────

function transformTernaryToIf(expr: Expression, state: TransformState) {
	if (expr.type !== 'ConditionalExpression') return b.literal(null);
	const condExpr = walkNode(expr.test, state);
	const trueExpr = walkNode(unwrapParen(expr.consequent), state);
	const args = [b.arrow([], condExpr), b.arrow([], trueExpr)];
	if (!isNullish(expr.alternate)) {
		args.push(b.arrow([], walkNode(unwrapParen(expr.alternate), state)));
	}
	return b.call('$.if', args);
}

function transformLogicalAndToIf(expr: Expression, state: TransformState) {
	if (expr.type !== 'LogicalExpression') return b.literal(null);
	return b.call('$.if', [
		b.arrow([], walkNode(expr.left, state)),
		b.arrow([], walkNode(unwrapParen(expr.right), state)),
	]);
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Compute which scope attrs apply to an element at a given path in the JSX tree.
 * A style block applies to an element if the element's path starts with the style's scopePath.
 * For example, a style at scopePath=[1] applies to elements at [1], [1,0], [1,1,2], etc.
 * A style at scopePath=[] applies to all elements.
 */
function computeScopeAttrsForElement(styles: ProcessedStyle[], elementPath: number[]): string[] {
	const matching: { attr: string; depth: number }[] = [];
	for (const style of styles) {
		if (!style.attr) continue; // global style, no scope attr
		// Check if element is inside (or at) the style's scope
		const sp = style.scopePath;
		if (sp.length > elementPath.length) continue; // style is deeper than element
		let matches = true;
		for (let i = 0; i < sp.length; i++) {
			if (sp[i] !== elementPath[i]) {
				matches = false;
				break;
			}
		}
		if (matches) matching.push({ attr: style.attr, depth: sp.length });
	}
	// Sort by scope depth (outer/shallower scopes first)
	matching.sort((a, b) => a.depth - b.depth);
	return matching.map(m => m.attr);
}

function hasModuleReactiveDecls(analysis: AnalysisResult): boolean {
	// Check module scope for state/derived declarations
	for (const [, binding] of analysis.scope.declarations) {
		if (binding.kind === 'state' || binding.kind === 'derived') return true;
	}
	// Check all scopes for function-level state/derived and cross-module reactive params
	for (const scope of analysis.scopes.values()) {
		for (const [, binding] of scope.declarations) {
			if (binding.kind === 'state' || binding.kind === 'derived') return true;
			if (binding.kind === 'prop' && binding.reactive) return true;
		}
	}
	return false;
}

function hasModuleLevelJsx(program: AstNode, analysis: AnalysisResult): boolean {
	if (program.type !== 'Program') return false;

	// Check if there are JSX nodes outside of component functions
	function containsJsx(node: unknown): boolean {
		if (!node || typeof node !== 'object') return false;
		if ('type' in node && (node.type === 'JSXElement' || node.type === 'JSXFragment')) return true;
		for (const [key, val] of Object.entries(node)) {
			if (key === 'type' || key === 'start' || key === 'end') continue;
			if (Array.isArray(val)) {
				for (const item of val) {
					if (containsJsx(item)) return true;
				}
			} else if (containsJsx(val)) return true;
		}
		return false;
	}

	for (const stmt of program.body) {
		// Skip component functions — they already trigger needsRuntime via components.size
		if (analysis.components.has(stmt)) continue;
		if (containsJsx(stmt)) return true;
	}
	return false;
}

function getTagName(nameNode: JSXElementName | JSXMemberExpressionObject): string {
	if (nameNode.type === 'JSXIdentifier') return nameNode.name;
	if (nameNode.type === 'JSXMemberExpression') {
		return `${getTagName(nameNode.object)}.${nameNode.property.name}`;
	}
	return 'unknown';
}

function getAttrName(nameNode: JSXAttributeName): string {
	if (nameNode.type === 'JSXIdentifier') return nameNode.name;
	if (nameNode.type === 'JSXNamespacedName') {
		return `${nameNode.namespace.name}:${nameNode.name.name}`;
	}
	return 'unknown';
}

function unwrapParen(node: Expression): Expression {
	while (node.type === 'ParenthesizedExpression') node = node.expression;
	return node;
}

function isObjectLiteral(node: AstNode): boolean {
	return node.type === 'ObjectExpression';
}

function isJSXExpr(node: Expression): boolean {
	const unwrapped = unwrapParen(node);
	return unwrapped.type === 'JSXElement' || unwrapped.type === 'JSXFragment';
}

function isJSXBody(node: Expression): boolean {
	if (isJSXExpr(node)) return true;
	if (node.type === 'ParenthesizedExpression') return isJSXBody(node.expression);
	return false;
}

function isNullish(node: Expression): boolean {
	const unwrapped = unwrapParen(node);
	if (unwrapped.type === 'Literal' && 'value' in unwrapped && unwrapped.value === null) return true;
	if (unwrapped.type === 'Identifier' && unwrapped.name === 'undefined') return true;
	return false;
}

function expressionIsReactive(expr: Expression | Argument, state: TransformState): boolean {
	if (expr.type === 'SpreadElement') return expressionIsReactive(expr.argument, state);
	if (expr.type === 'Identifier') {
		const binding = state.scope.get(expr.name);
		return !!binding?.reactive;
	}
	if (expr.type === 'ChainExpression') {
		return expressionIsReactive(expr.expression, state);
	}
	if (expr.type === 'MemberExpression') {
		if (expr.computed && expressionIsReactive(expr.property, state)) return true;
		return expressionIsReactive(expr.object, state);
	}
	if (expr.type === 'CallExpression') {
		for (const arg of expr.arguments) {
			if (expressionIsReactive(arg, state)) return true;
		}
		return expressionIsReactive(expr.callee, state);
	}
	if (expr.type === 'BinaryExpression' || expr.type === 'LogicalExpression') {
		if (expr.left.type === 'PrivateIdentifier') return expressionIsReactive(expr.right, state);
		return expressionIsReactive(expr.left, state) || expressionIsReactive(expr.right, state);
	}
	if (expr.type === 'UnaryExpression' || expr.type === 'UpdateExpression') {
		return expressionIsReactive(expr.argument, state);
	}
	if (expr.type === 'ConditionalExpression') {
		return expressionIsReactive(expr.test, state) ||
			expressionIsReactive(expr.consequent, state) ||
			expressionIsReactive(expr.alternate, state);
	}
	if (expr.type === 'TemplateLiteral') {
		for (const e of expr.expressions) {
			if (expressionIsReactive(e, state)) return true;
		}
		return false;
	}
	if (expr.type === 'ArrayExpression') {
		for (const el of expr.elements) {
			if (el && expressionIsReactive(el, state)) return true;
		}
		return false;
	}
	if (expr.type === 'ObjectExpression') {
		for (const prop of expr.properties) {
			if (prop.type === 'Property' && expressionIsReactive(prop.value, state)) return true;
			if (prop.type === 'SpreadElement' && expressionIsReactive(prop.argument, state)) return true;
		}
		return false;
	}
	return false;
}

function isInReactiveCallArg(
	node: AstNode,
	path: AstNode[],
	reactiveCallTargets: Map<string, Set<number>>,
): boolean {
	if (reactiveCallTargets.size === 0) return false;
	for (let i = path.length - 1; i >= 0; i--) {
		const ancestor = path[i];
		if (ancestor.type === 'CallExpression' && ancestor.callee.type === 'Identifier') {
			const indices = reactiveCallTargets.get(ancestor.callee.name);
			if (!indices) continue;
			const args = ancestor.arguments;
			for (const idx of indices) {
				const arg = args[idx];
				if (!arg) continue;
				if (node.start >= arg.start && node.end <= arg.end) return true;
			}
		}
	}
	return false;
}

/** Build a getter property from a walked node, returning null if the node is a null literal */
function buildBindGetter(key: string, node: AstNode): AstNode | null {
	if (node.type === 'Literal' && node.value === null) return null;
	if (node.type === 'ArrowFunctionExpression') {
		const body = node.body.type === 'BlockStatement'
			? node.body.body
			: [b.returnStmt(node.body)];
		return b.getter(key, body);
	}
	return b.getter(key, [b.returnStmt(b.call(node, []))]);
}

/** Build a setter property from a walked node, returning null if the node is a null literal */
function buildBindSetter(key: string, node: AstNode): AstNode | null {
	if (node.type === 'Literal' && node.value === null) return null;
	if (node.type === 'ArrowFunctionExpression') {
		const param = node.params[0] || b.id('v');
		const body = node.body.type === 'BlockStatement'
			? node.body.body
			: [b.exprStmt(node.body)];
		return b.setter(key, param, body);
	}
	return b.setter(key, b.id('v'), [b.exprStmt(b.call(node, [b.id('v')]))]);
}

function normalizeJSXText(text: string, isFirst: boolean, isLast: boolean): string {
	let result = text.replace(/\s*\n\s*/g, ' ');
	if (isFirst) result = result.replace(/^\s+/, '');
	if (isLast) result = result.replace(/\s+$/, '');
	return decodeHTML(result);
}

// ── Scoped CSS Processing ──────────────────────────────────────────

interface ProcessedStyle {
	hash: string;
	attr: string;
	css: string;
	scopePath: number[];
	cssVars: CSSVar[];
}

function processStyles(blocks: StyleBlockIR[], componentName: string, filename: string): ProcessedStyle[] {
	const results: ProcessedStyle[] = [];
	const basename = filename.replace(/^.*[/\\]/, '');
	for (const block of blocks) {
		const hashInput = `${basename}::${componentName}::${block.index}`;
		const hash = scopeHash(hashInput);
		let css = dedentCSS(block.css);
		const extracted = extractCSSVars(css, hash);
		css = extracted.css;
		if (block.isGlobal) {
			results.push({ hash, attr: '', css, scopePath: block.scopePath, cssVars: extracted.cssVars });
			continue;
		}
		const rewrittenCSS = rewriteScopedCSS(css, hash);
		results.push({ hash, attr: hash, css: rewrittenCSS, scopePath: block.scopePath, cssVars: extracted.cssVars });
	}
	return results;
}

function dedentCSS(css: string): string {
	const lines = css.split('\n');
	while (lines.length > 0 && lines[0].trim() === '') lines.shift();
	while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
	if (lines.length === 0) return '';
	let minIndent = Infinity;
	for (const line of lines) {
		if (line.trim().length === 0) continue;
		const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
		if (indent < minIndent) minIndent = indent;
	}
	if (minIndent === 0 || minIndent === Infinity) return lines.join('\n');
	return lines.map(l => l.slice(minIndent)).join('\n');
}

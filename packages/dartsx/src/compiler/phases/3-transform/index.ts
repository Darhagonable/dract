/**
 * Phase 3 — Transform
 *
 * Walks the OXC AST with zimmerframe and replaces nodes to produce
 * the output JavaScript AST. Uses the scope tree and binding metadata
 * from Phase 2 to perform reactive transformations.
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
 * - `CallExpression`: __if/__for/__switch/__try/__block → $.if/$.for/etc.
 */
import { walk, type Context } from 'zimmerframe';
import type { AnalysisResult, ComponentInfo, StyleBlockIR } from '../2-analyze';
import { STATE_MARKER, DERIVED_MARKER, STYLE_MARKER_PREFIX } from '../1-parse';
import type { Scope } from '../../scope';
import { scopeHash, SCOPE_ATTR, rewriteScopedCSS, extractCSSVars, type CSSVar } from './css';
import * as b from '../../builders';
import { print, type PrintOptions } from 'esrap';
import tsx from 'esrap/languages/tsx';
import { decodeHTML } from 'entities';
import { parseSync } from 'oxc-parser';
import type {
	Node,
	Span,
	Expression,
	Argument,
	ParamPattern,
	Function as OxcFunction,
	VariableDeclaration,
	AssignmentExpression,
	UpdateExpression,
	CallExpression,
	JSXChild,
	JSXElement,
	JSXElementName,
	JSXAttributeName,
	JSXAttribute,
	JSXMemberExpressionObject,
} from 'oxc-parser';

// ── Types ──────────────────────────────────────────────────────────

/** OXC AST node that has a span (filters out Modifier which lacks start/end) */
type AstNode = Extract<Node, Span>;

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

	const transformed = walk<AstNode, TransformState>(analysis.ast, initialState, {
		_(node, { next, state }) {
			const scope = state.analysis.scopes.get(node);
			if (scope && scope !== state.scope) {
				next({ ...state, scope });
			} else {
				next();
			}
		},

		Program(node, { state, visit }) {
			const body: AstNode[] = [];
			let needsRuntime = false;

			if (state.analysis.components.size > 0 || hasModuleReactiveDecls(state.analysis)) {
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

		VariableDeclaration(node, { state, next }) {
			return transformVariableDeclaration(node, state, next);
		},

		FunctionDeclaration(node, { state, next }) {
			const compInfo = state.analysis.components.get(node);
			if (compInfo) {
				return transformComponent(node, compInfo, state, state.filename, state.cssFragments, state.emitStyleCalls);
			}
			return next();
		},

		Identifier(node, { state, path }) {
			return transformIdentifier(node, state, path);
		},

		Property(node, { state, next }) {
			if (node.type !== 'Property') return next();
			return transformShorthandProperty(node, state, next);
		},

		AssignmentExpression(node, { state, visit }) {
			return transformAssignment(node, state, visit);
		},

		UpdateExpression(node, { state }) {
			return transformUpdate(node, state);
		},

		JSXElement(node, { state, visit }) {
			return transformJSXElement(node, state, visit);
		},

		JSXFragment(node, { state, visit }) {
			const children = transformJSXChildren(node.children, state, visit);
			if (children.length === 0) return b.literal(null);
			if (children.length === 1) return children[0];
			return b.call('$.jsx', [
				b.member('$.Fragment'),
				b.object([b.prop('children', b.array(children))]),
			]);
		},

		CallExpression(node, { state, visit, next }) {
			if (node.callee.type !== 'Identifier') return next();
			const fn = node.callee.name;
			if (fn === '__if') return transformIfCall(node, state, visit);
			if (fn === '__for') return transformForCall(node, state, visit);
			if (fn === '__switch') return transformSwitchCall(node, state, visit);
			if (fn === '__try') return transformTryCall(node, state, visit);
			if (fn === '__block') return transformBlockCall(node, state, visit);
			if (fn === '__html') return transformHtmlCall(node, state);
			return transformReactiveCallOrNext(node, state, next);
		},

		JSXExpressionContainer(node, { state, visit }) {
			return visit(node.expression, state);
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
		for (const param of fnNode.params) {
			const propStmt = transformParam(param, renamedParams, parentState.analysis.source, propsName);
			if (propStmt) stmts.push(propStmt);
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
		stmts.push(walkNode(stmt, compState));
	}

	// Build the function
	const params = hasProps ? [b.id(propsName)] : [];
	const funcDecl = b.func(meta.name, params, stmts, meta.isAsync);

	if (meta.isExport && meta.isDefault) return b.exportDefault(funcDecl);
	if (meta.isExport) return b.exportNamed(funcDecl);
	return funcDecl;
}

function transformParam(param: ParamPattern, renamedParams: Record<string, string>, source: string, propsName = '$$props') {
	if (param.type === 'RestElement') {
		const name = param.argument.type === 'Identifier' ? param.argument.name : 'rest';
		return b.letDecl(name, b.id(propsName));
	}

	// FormalParameter: BindingIdentifier | AssignmentPattern | ObjectPattern | ArrayPattern
	let rawName: string | undefined;
	if (param.type === 'Identifier') {
		rawName = param.name;
	} else if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') {
		rawName = param.left.name;
	}
	if (!rawName) return null;

	const isBind = rawName.startsWith('__bind__');
	const name = isBind ? rawName.slice(8) : rawName;
	const externalName = renamedParams[name] || name;

	const defaultValue = param.type === 'AssignmentPattern' ? param.right : null;

	if (isBind) {
		const args: AstNode[] = [b.id(propsName), b.literal(externalName)];
		if (defaultValue) args.push(defaultValue);
		return b.letDecl(name, b.call('$.prop.bind', args));
	}

	const args: AstNode[] = [b.id(propsName), b.literal(externalName)];
	if (defaultValue) args.push(defaultValue);
	return b.constDecl(name, b.call('$.prop', args));
}

// ── Walk a single node with component-level visitors ───────────────

function walkNode(node: AstNode, state: TransformState): AstNode {
	return walk<AstNode, TransformState>(node, state, {
		_(node, { next, state: s }) {
			const scope = s.analysis.scopes.get(node);
			if (scope && scope !== s.scope) {
				next({ ...s, scope });
			} else {
				next();
			}
		},
		FunctionDeclaration(node, { state: s, next }) {
			const compInfo = s.analysis.components.get(node);
			if (compInfo) {
				return transformComponent(node, compInfo, s, s.filename, s.cssFragments, s.emitStyleCalls);
			}
			return next();
		},
		VariableDeclaration(node, { state: s, next }) {
			return transformVariableDeclaration(node, s, next);
		},
		Identifier(node, { state: s, path }) {
			return transformIdentifier(node, s, path);
		},
		Property(node, { state: s, next }) {
			if (node.type !== 'Property') return next();
			return transformShorthandProperty(node, s, next);
		},
		AssignmentExpression(node, { state: s, visit }) {
			return transformAssignment(node, s, visit);
		},
		UpdateExpression(node, { state: s }) {
			return transformUpdate(node, s);
		},
		JSXElement(node, { state: s, visit }) {
			return transformJSXElement(node, s, visit);
		},
		JSXFragment(node, { state: s, visit }) {
			const children = transformJSXChildren(node.children, s, visit, true);
			if (children.length === 0) return b.literal(null);
			if (children.length === 1) return children[0];
			return b.call('$.jsx', [
				b.member('$.Fragment'),
				b.object([b.prop('children', b.array(children))]),
			]);
		},
		CallExpression(node, { state: s, visit, next }) {
			if (node.callee.type !== 'Identifier') return next();
			const fn = node.callee.name;
			if (fn === '__if') return transformIfCall(node, s, visit);
			if (fn === '__for') return transformForCall(node, s, visit);
			if (fn === '__switch') return transformSwitchCall(node, s, visit);
			if (fn === '__try') return transformTryCall(node, s, visit);
			if (fn === '__block') return transformBlockCall(node, s, visit);
			if (fn === '__html') return transformHtmlCall(node, s);
			return transformReactiveCallOrNext(node, s, next);
		},
		JSXExpressionContainer(node, { state: s, visit }) {
			return visit(node.expression, s);
		},
	});
}

// ── Shared transform functions ─────────────────────────────────────

function transformVariableDeclaration(node: VariableDeclaration, state: TransformState, next: WalkContext['next']) {
	const newDeclarators: typeof node.declarations = [];
	let changed = false;

	for (const decl of node.declarations) {
		if (decl.id.type !== 'Identifier') {
			newDeclarators.push(decl);
			continue;
		}
		const name = decl.id.name;

		// Skip $$s*/$$d* marker declarators (emitted by preprocess)
		if (name.startsWith(STATE_MARKER) || name.startsWith(DERIVED_MARKER)) {
			changed = true;
			continue;
		}

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

	// Proxy/derived/bind-prop: direct member access (obj.foo), no $.get() on the root
	if (parent.type === 'MemberExpression' && parent.object === node && binding.directMemberAccess) return;

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
		const attrResult = transformJSXAttribute(attr, state, isComponent);
		if (attrResult) props.push(attrResult);
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
		props.push(b.prop('style', isReactive ? b.arrow([], styleObj) : styleObj));
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
	return b.call(factory, [tag, b.object(props)]);
}

function transformJSXAttribute(attr: JSXAttribute, state: TransformState, isComponent: boolean) {
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
					const getter = walkNode(el0, state);
					const setter = walkNode(el1, state);
					return b.prop(`bind:${local}`, b.array([getter, setter]));
				}
			}
			if (expr && expr.type !== 'JSXEmptyExpression') {
				const getter = b.arrow([], walkNode(expr, state));
				let setter: AstNode;
				if (expr.type === 'Identifier') {
					const binding = state.scope.get(expr.name);
					if (binding?.writable) {
						setter = b.arrow([b.id('v')], b.call('$.set', [b.id(expr.name), b.id('v')]));
					} else {
						setter = b.arrow([b.id('v')], b.assignment('=', b.id(expr.name), b.id('v')));
					}
				} else {
					// MemberExpression or other: use direct assignment
					setter = b.arrow([b.id('v')], b.assignment('=', walkNode(expr, state), b.id('v')));
				}
				return b.prop(`bind:${local}`, b.array([getter, setter]));
			}
			return null;
		}
	}

	// Boolean: disabled
	if (attr.value === null && attr.name.type === 'JSXIdentifier') {
		return b.prop(attrName, b.literal(true));
	}

	// Event handler: onclick={...}
	if (attrName.startsWith('on') && attrName.length > 2) {
		if (attr.value?.type === 'JSXExpressionContainer') {
			const expr = attr.value.expression;
			if (expr.type === 'JSXEmptyExpression') return b.prop(attrName, b.literal(null));
			const handler = transformEventHandler(expr, state);
			return b.prop(attrName, handler);
		}
		return b.prop(attrName, b.literal(null));
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

		if (isReactive && isComponent) {
			const transformed = walkNode(expr, state);
			return b.getter(attrName, [b.returnStmt(transformed)]);
		}
		if (isReactive) {
			// Walk with insideDerived so shorthand properties use eager $.get()
			// instead of getters (the wrapping thunk already provides reactivity)
			const transformed = walkNode(expr, { ...state, insideDerived: true });
			return b.prop(attrName, b.arrow([], transformed));
		}
		const transformed = walkNode(expr, state);
		return b.prop(attrName, transformed);
	}

	return b.prop(attrName, b.literal(null));
}

function transformEventHandler(expr: Expression, state: TransformState) {
	if (expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression') {
		return walkNode(expr, state);
	}
	if (expr.type === 'Identifier' || expr.type === 'MemberExpression') {
		return walkNode(expr, state);
	}
	return b.arrow([], walkNode(expr, state));
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
				const isControlFlow = (n: JSXChild | null) => n?.type === 'JSXExpressionContainer' &&
					n.expression.type === 'CallExpression' && n.expression.callee.type === 'Identifier' &&
					['__if', '__for', '__switch', '__try', '__block'].includes(n.expression.callee.name);
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

			// Control flow calls
			if (expr.type === 'CallExpression' && expr.callee.type === 'Identifier') {
				const fn = expr.callee.name;
				if (fn === '__if' || fn === '__for' || fn === '__switch' || fn === '__try' || fn === '__block' || fn === '__html') {
					result.push(walkNode(expr, state));
					continue;
				}
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

			// .map() → $.for()
			if (expr.type === 'CallExpression' &&
				expr.callee.type === 'MemberExpression' &&
				expr.callee.property.type === 'Identifier' && expr.callee.property.name === 'map') {
				const callback = expr.arguments[0];
				if (callback && (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') &&
					callback.body && callback.body.type !== 'BlockStatement' &&
					isJSXBody(callback.body)) {
					result.push(transformMapToFor(expr, state));
					continue;
				}
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

function transformIfCall(node: CallExpression, state: TransformState, visit: WalkContext['visit']) {
	const args = node.arguments;
	const condArrow = args[0];
	const trueArrow = args[1];
	const falseArrow = args[2];

	const condExpr = condArrow?.type === 'ArrowFunctionExpression'
		? condArrow.body.type === 'BlockStatement' ? walkNode(condArrow.body, state) : walkNode(unwrapParen(condArrow.body), state)
		: b.literal(true);

	const resultArgs = [
		b.arrow([], condExpr),
		transformCFCallback(trueArrow, state),
	];

	if (falseArrow) {
		resultArgs.push(transformCFCallback(falseArrow, state));
	}

	return b.call('$.if', resultArgs);
}

function transformForCall(node: CallExpression, state: TransformState, visit: WalkContext['visit']) {
	const args = node.arguments;
	const collArrow = args[0];
	const bodyArrow = args[1];
	const keyArrow = args[2];

	const collExpr = collArrow?.type === 'ArrowFunctionExpression'
		? collArrow.body.type === 'BlockStatement' ? walkNode(collArrow.body, state) : walkNode(unwrapParen(collArrow.body), state)
		: b.array([]);

	const resultArgs = [
		b.arrow([], collExpr),
		transformCFCallback(bodyArrow, state),
	];

	if (keyArrow && keyArrow.type === 'ArrowFunctionExpression') {
		const keyExpr = keyArrow.body.type === 'BlockStatement'
			? walkNode(keyArrow.body, state)
			: walkNode(unwrapParen(keyArrow.body), state);
		const keyParams = keyArrow.params.map((p: ParamPattern) => {
			if (p.type === 'Identifier') return b.id(p.name);
			if (p.type === 'RestElement' && p.argument.type === 'Identifier') return b.id(p.argument.name);
			return b.id('item');
		});
		resultArgs.push(b.arrow(keyParams, keyExpr));
	}

	return b.call('$.for', resultArgs);
}

function transformSwitchCall(node: CallExpression, state: TransformState, visit: WalkContext['visit']) {
	const args = node.arguments;
	const discArrow = args[0];

	const discExpr = discArrow?.type === 'ArrowFunctionExpression'
		? discArrow.body.type === 'BlockStatement' ? walkNode(discArrow.body, state) : walkNode(unwrapParen(discArrow.body), state)
		: b.literal('');

	const cases: AstNode[] = [];
	for (let i = 1; i < args.length; i += 2) {
		const valuesArg = args[i];
		const fnArg = args[i + 1];

		let valuesExpr: AstNode;
		if (valuesArg && valuesArg.type === 'ArrayExpression') {
			valuesExpr = b.array(valuesArg.elements.map((el) => el ? walkNode(el, state) : b.literal(null)));
		} else {
			valuesExpr = b.literal(null);
		}

		const fn = fnArg ? transformCFCallback(fnArg, state) : b.arrow([], b.literal(null));
		cases.push(b.object([
			b.prop('values', valuesExpr),
			b.prop('fn', fn),
		]));
	}

	return b.call('$.switch', [b.arrow([], discExpr), b.array(cases)]);
}

function transformTryCall(node: CallExpression, state: TransformState, visit: WalkContext['visit']) {
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

function transformBlockCall(node: CallExpression, state: TransformState, visit: WalkContext['visit']) {
	const arrowFn = node.arguments[0];
	if (!arrowFn) return b.literal(null);
	return walkNode(arrowFn, state);
}

function transformHtmlCall(node: CallExpression, state: TransformState) {
	const arg = node.arguments[0];
	if (!arg || arg.type === 'SpreadElement') return b.literal(null);
	const transformed = walkNode(arg, state);
	return b.call('$.html', [b.arrow([], transformed)]);
}

function transformCFCallback(arrowFn: Argument | undefined, state: TransformState): AstNode {
	if (!arrowFn || arrowFn.type === 'SpreadElement') return b.arrow([], b.literal(null));

	// Only arrow functions and function expressions have params/body
	if (arrowFn.type !== 'ArrowFunctionExpression' && arrowFn.type !== 'FunctionExpression' && arrowFn.type !== 'FunctionDeclaration') {
		return b.arrow([], walkNode(arrowFn, state));
	}

	const params = arrowFn.params.map((p: ParamPattern) => {
		if (p.type === 'Identifier') return b.id(p.name);
		if (p.type === 'RestElement' && p.argument.type === 'Identifier') return b.id(p.argument.name);
		if (p.type === 'AssignmentPattern' && p.left.type === 'Identifier') return b.id(p.left.name);
		return b.id('item');
	});

	// Switch to the arrow function's scope if registered
	const arrowScope = state.analysis.scopes.get(arrowFn);
	const innerState = arrowScope ? { ...state, scope: arrowScope } : state;

	if (arrowFn.type === 'ArrowFunctionExpression') {
		if (arrowFn.body.type === 'BlockStatement') {
			const transformedStmts: AstNode[] = [];
			for (const stmt of arrowFn.body.body) {
				transformedStmts.push(walkNode(stmt, innerState));
			}
			// Collapse single-return block to expression arrow
			if (transformedStmts.length === 1 && transformedStmts[0].type === 'ReturnStatement' && transformedStmts[0].argument) {
				return b.arrow(params, transformedStmts[0].argument);
			}
			return b.arrowBlock(params, transformedStmts);
		}
		// Expression body
		const exprBody = unwrapParen(arrowFn.body);
		const transformed = walkNode(exprBody, innerState);
		return b.arrow(params, transformed);
	}

	// FunctionExpression / FunctionDeclaration
	if (arrowFn.body) {
		const transformedStmts: AstNode[] = [];
		for (const stmt of arrowFn.body.body) {
			transformedStmts.push(walkNode(stmt, innerState));
		}
		if (transformedStmts.length === 1 && transformedStmts[0].type === 'ReturnStatement' && transformedStmts[0].argument) {
			return b.arrow(params, transformedStmts[0].argument);
		}
		return b.arrowBlock(params, transformedStmts);
	}

	return b.arrow(params, b.literal(null));
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

function transformMapToFor(expr: CallExpression, state: TransformState) {
	if (expr.callee.type !== 'MemberExpression') return b.literal(null);
	const collection = walkNode(expr.callee.object, state);
	const callback = expr.arguments[0];
	return b.call('$.for', [
		b.arrow([], collection),
		transformCFCallback(callback, state),
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
	// Check for cross-module reactive params (function params upgraded to 'prop' kind)
	for (const scope of analysis.scopes.values()) {
		for (const [, binding] of scope.declarations) {
			if (binding.kind === 'prop' && binding.reactive) return true;
		}
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
	for (const block of blocks) {
		const hashInput = `${filename}::${componentName}::${block.index}`;
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

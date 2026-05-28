/**
 * Phase 3 — Transform
 *
 * Walks the OXC AST with zimmerframe to produce output JavaScript.
 * Uses scope/binding info from Phase 2 for reactive transforms.
 *
 * Key transforms:
 * - component → function with $$props
 * - state/derived → $.state()/$.derived()
 * - reactive reads/writes → $.get()/$.set()
 * - JSX → $.jsx() runtime calls
 * - IIFE-wrapped control flow → $.if/$.for/$.switch/$.try
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

type AstNode = Extract<Node, Span>;
type WalkContext = Context<AstNode, TransformState>;

export interface TransformResult {
	code: string;
	map: ReturnType<typeof print>['map'];
	css: string;
}

interface TransformState {
	scope: Scope;
	analysis: AnalysisResult;
	component: ComponentInfo | null;
	scopeAttrs: string[];
	processedStyles: ProcessedStyle[];
	elementPath: number[];
	cssVars: CSSVar[];
	reactiveCallTargets: Map<string, Set<number>>;
	nsContext: 'html' | 'svg' | 'math';
	filename: string;
	cssFragments: string[];
	emitStyleCalls: boolean;
	insideDerived: boolean;
}

// ── Shared Visitors ────────────────────────────────────────────────

const sharedVisitors = {
	_(node: AstNode, { next, state }: WalkContext) {
		const scope = state.analysis.scopes.get(node);
		if (scope && scope !== state.scope) next({ ...state, scope });
		else next();
	},

	VariableDeclaration(node: AstNode, { state, next }: WalkContext) {
		return transformVariableDeclaration(node as VariableDeclaration, state, next);
	},

	FunctionDeclaration(node: AstNode, { state, next }: WalkContext) {
		const compInfo = state.analysis.components.get(node);
		if (compInfo) return transformComponent(node, compInfo, state, state.filename, state.cssFragments, state.emitStyleCalls);
		return next();
	},

	Identifier(node: AstNode, { state, path }: WalkContext) {
		return transformIdentifier(node, state, path);
	},

	Property(node: AstNode, { state, next }: WalkContext) {
		if (node.type !== 'Property') return next();
		return transformShorthandProperty(node as any, state, next);
	},

	AssignmentExpression(node: AstNode, { state, visit }: WalkContext) {
		return transformAssignment(node as AssignmentExpression, state, visit);
	},

	UpdateExpression(node: AstNode, { state }: WalkContext) {
		return transformUpdate(node as UpdateExpression, state);
	},

	JSXElement(node: AstNode, { state, visit }: WalkContext) {
		return transformJSXElement(node as JSXElement, state, visit);
	},

	JSXFragment(node: AstNode, { state, visit }: WalkContext) {
		const children = transformJSXChildren((node as any).children, state, visit, true);
		if (children.length === 0) return b.literal(null);
		if (children.length === 1) return children[0];
		return b.call('$.jsx', [b.member('$.Fragment'), b.object([b.prop('children', b.array(children))])]);
	},

	CallExpression(node: AstNode, { state, next }: WalkContext) {
		if ((node as CallExpression).callee.type !== 'Identifier') return next();
		const fn = ((node as CallExpression).callee as any).name;
		if (fn === '__html') return transformHtmlCall(node as CallExpression, state);
		return transformReactiveCallOrNext(node as CallExpression, state, next);
	},

	JSXExpressionContainer(node: AstNode, { state, visit }: WalkContext) {
		return visit((node as any).expression, state);
	},
};

// ── Main Entry ─────────────────────────────────────────────────────

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
		...sharedVisitors,

		Program(node, { state, visit }) {
			const body: AstNode[] = [];
			let needsRuntime = false;

			if (state.analysis.components.size > 0 || hasModuleReactiveDecls(state.analysis) || hasModuleLevelJsx(node, state.analysis)) {
				needsRuntime = true;
			}

			if (needsRuntime) body.push(b.importDefault('$', 'dartsx/internal/client'));

			for (const stmt of node.body) {
				if (stmt.type === 'ImportDeclaration') {
					if (stmt.source.value.startsWith('dartsx/internal')) continue;
					body.push(stmt);
					continue;
				}
				const compInfo = state.analysis.components.get(stmt);
				if (compInfo) {
					body.push(transformComponent(stmt, compInfo, state, state.filename, state.cssFragments, state.emitStyleCalls));
					continue;
				}
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

// ── Walk Node ──────────────────────────────────────────────────────

function walkNode(node: AstNode, state: TransformState): AstNode {
	return walk<AstNode, TransformState>(node, state, sharedVisitors);
}

// ── Component Transform ────────────────────────────────────────────

function extractFnNode(node: AstNode): OxcFunction | null {
	if (node.type === 'FunctionDeclaration') return node;
	if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration') return node.declaration;
	if (node.type === 'ExportDefaultDeclaration' && node.declaration.type === 'FunctionDeclaration') return node.declaration;
	return null;
}

function transformComponent(
	outerNode: AstNode, compInfo: ComponentInfo, parentState: TransformState,
	filename: string | undefined, cssFragments: string[], emitStyleCalls: boolean,
) {
	const { meta, styleBlocks, renamedParams, scope: compScope } = compInfo;

	const processedStyles = processStyles(styleBlocks, meta.name, filename || 'input.tsx');
	const scopeAttrs = processedStyles.filter(s => s.attr).map(s => s.attr);
	const allCssVars = processedStyles.flatMap(s => s.cssVars);
	for (const ps of processedStyles) cssFragments.push(ps.css);

	const fnNode = extractFnNode(outerNode);
	if (!fnNode) return outerNode;

	const hasProps = fnNode.params.length > 0;
	const isNested = compScope.parent !== parentState.analysis.scope;
	const propsName = isNested ? '$props' : '$$props';
	const stmts: AstNode[] = [];

	if (emitStyleCalls) {
		for (const ps of processedStyles)
			stmts.push(b.exprStmt(b.call('$.style', [b.literal(ps.hash), b.literal(ps.css)])));
	}

	if (hasProps) {
		const firstParam = fnNode.params[0];
		if (firstParam && firstParam.type === 'ObjectPattern') {
			// Destructured form from preprocessor
			for (const prop of (firstParam as any).properties) {
				const propStmt = transformObjectPatternProp(prop, renamedParams, parentState.analysis.source, propsName);
				if (propStmt) stmts.push(propStmt);
			}
		} else {
			for (const param of fnNode.params) {
				const propStmt = transformParam(param, renamedParams, parentState.analysis.source, propsName);
				if (propStmt) stmts.push(propStmt);
			}
		}
	}

	const compState: TransformState = {
		...parentState, scope: compScope, component: compInfo,
		scopeAttrs, processedStyles, elementPath: [], cssVars: allCssVars,
	};

	if (!fnNode.body) return outerNode;
	for (const stmt of fnNode.body.body) {
		if (stmt.type === 'ReturnStatement' && stmt.argument) {
			let jsxNode: Expression = stmt.argument;
			while (jsxNode.type === 'ParenthesizedExpression') jsxNode = jsxNode.expression;

			if (jsxNode.type === 'JSXElement' || jsxNode.type === 'JSXFragment') {
				stmts.push(b.returnStmt(walkNode(jsxNode, compState)));
				continue;
			}
			const iifeBody = unwrapIIFE(jsxNode);
			if (iifeBody) {
				stmts.push(b.returnStmt(transformIIFEBody(iifeBody, compState)));
				continue;
			}
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

	let rawName: string | undefined;
	if (param.type === 'Identifier') rawName = param.name;
	else if (param.type === 'AssignmentPattern' && param.left.type === 'Identifier') rawName = param.left.name;
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

function transformObjectPatternProp(prop: any, renamedParams: Record<string, string>, source: string, propsName: string) {
	if (prop.type === 'RestElement') {
		const name = prop.argument.type === 'Identifier' ? prop.argument.name : 'rest';
		return b.letDecl(name, b.id(propsName));
	}

	// Property node: extract binding name from value
	let rawName: string | undefined;
	let defaultValue: AstNode | null = null;
	if (prop.value.type === 'Identifier') {
		rawName = prop.value.name;
	} else if (prop.value.type === 'AssignmentPattern' && prop.value.left.type === 'Identifier') {
		rawName = prop.value.left.name;
		defaultValue = prop.value.right;
	}
	if (!rawName) return null;

	const isBind = rawName.startsWith('__bind__');
	const name = isBind ? rawName.slice(8) : rawName;

	// For renamed props, the key is a string literal with the external name
	let externalName: string;
	if (prop.key.type === 'StringLiteral' || prop.key.type === 'Literal') {
		externalName = prop.key.value;
	} else {
		externalName = renamedParams[name] || name;
	}

	if (isBind) {
		const args: AstNode[] = [b.id(propsName), b.literal(externalName)];
		if (defaultValue) args.push(defaultValue);
		return b.letDecl(name, b.call('$.prop.bind', args));
	}

	const args: AstNode[] = [b.id(propsName), b.literal(externalName)];
	if (defaultValue) args.push(defaultValue);
	return b.constDecl(name, b.call('$.prop', args));
}

// ── Variable Declaration Transform ─────────────────────────────────

function transformVariableDeclaration(node: VariableDeclaration, state: TransformState, next: WalkContext['next']) {
	const newDeclarators: typeof node.declarations = [];
	let changed = false;
	let prevMarker: string | null = null;

	for (const decl of node.declarations) {
		if (decl.id.type !== 'Identifier') {
			if (prevMarker?.startsWith(DERIVED_MARKER) && (decl.id.type === 'ObjectPattern' || decl.id.type === 'ArrayPattern')) {
				changed = true;
				const derivedState = { ...state, insideDerived: true };
				const initExpr = decl.init ? walkNode(decl.init, derivedState) : b.id('undefined');
				lowerDerivedDestructuring(decl.id, initExpr, newDeclarators, state);
			} else {
				newDeclarators.push(decl);
			}
			prevMarker = null;
			continue;
		}
		const name = decl.id.name;

		if (name.startsWith(STATE_MARKER) || name.startsWith(DERIVED_MARKER)) {
			changed = true;
			prevMarker = name;
			continue;
		}
		prevMarker = null;

		const binding = state.scope.get(name);
		if (!binding) { newDeclarators.push(decl); continue; }

		if (binding.kind === 'state') {
			changed = true;
			const initExpr = decl.init ? walkNode(decl.init, state) : undefined;
			newDeclarators.push(b.declarator(b.id(name), b.call('$.state', initExpr ? [initExpr] : [])));
			continue;
		}

		if (binding.kind === 'derived') {
			changed = true;
			const derivedState = { ...state, insideDerived: true };
			const initExpr = decl.init ? walkNode(decl.init, derivedState) : b.id('undefined');

			// Unwrap IIFE pattern → block body
			if (initExpr.type === 'CallExpression') {
				const iifeCallee = initExpr.callee.type === 'ParenthesizedExpression' ? initExpr.callee.expression : initExpr.callee;
				if ((iifeCallee.type === 'ArrowFunctionExpression' || iifeCallee.type === 'FunctionExpression') &&
					initExpr.arguments.length === 0 && iifeCallee.body?.type === 'BlockStatement') {
					newDeclarators.push(b.declarator(b.id(name), b.call('$.derived', [b.arrowBlock([], iifeCallee.body.body)])));
					continue;
				}
			}

			const body = isObjectLiteral(initExpr) ? b.sequence([initExpr]) : initExpr;
			newDeclarators.push(b.declarator(b.id(name), b.call('$.derived', [b.arrow([], body)])));
			continue;
		}

		newDeclarators.push(decl);
	}

	if (changed) return { ...node, declarations: newDeclarators };
	return next();
}

let derivedDestructureCounter = 0;

function lowerDerivedDestructuring(pattern: AstNode, initExpr: AstNode, out: AstNode[], state: TransformState): void {
	const tempName = `__destructured_${derivedDestructureCounter++}`;
	out.push(b.declarator(b.id(tempName), initExpr));
	emitDerivedBindings(pattern, b.id(tempName), out);
}

function memberComputed(obj: AstNode, index: number): AstNode {
	return { type: 'MemberExpression', object: obj, property: b.literal(index), computed: true, start: 0, end: 0, loc: null } as any;
}

function memberDot(obj: AstNode, prop: string): AstNode {
	return { type: 'MemberExpression', object: obj, property: b.id(prop), computed: false, start: 0, end: 0, loc: null } as any;
}

function sliceCall(obj: AstNode, from: number): AstNode {
	return b.call(memberDot(obj, 'slice'), [b.literal(from)]);
}

function emitDerivedBindings(pattern: AstNode, baseExpr: AstNode, out: AstNode[]): void {
	if (pattern.type === 'ObjectPattern') {
		for (const prop of (pattern as any).properties || []) {
			if (!prop) continue;
			if (prop.type === 'RestElement') {
				if (prop.argument?.type === 'Identifier') {
					const otherKeys = ((pattern as any).properties || [])
						.filter((p: any) => p && p.type !== 'RestElement')
						.map((p: any) => p.key?.type === 'Identifier' ? p.key.name : p.key?.type === 'StringLiteral' ? p.key.value : null)
						.filter(Boolean) as string[];
					out.push(b.declarator(b.id(prop.argument.name), b.call('$.derived', [b.arrow([], buildObjectRest(baseExpr, otherKeys, prop.argument.name))])));
				}
				continue;
			}
			const key = prop.key?.type === 'Identifier' ? prop.key.name : (prop.key?.type === 'StringLiteral' ? prop.key.value : null);
			if (!key) continue;
			const accessExpr = memberDot(baseExpr, key);
			const value = prop.value || prop.key;
			if (value.type === 'Identifier') {
				out.push(b.declarator(b.id(value.name), b.call('$.derived', [b.arrow([], accessExpr)])));
			} else if (value.type === 'AssignmentPattern' && value.left?.type === 'Identifier') {
				const cond = b.binary('!==', accessExpr, b.id('undefined'));
				const ternary = { type: 'ConditionalExpression', test: cond, consequent: accessExpr, alternate: value.right, start: 0, end: 0, loc: null } as any;
				out.push(b.declarator(b.id(value.left.name), b.call('$.derived', [b.arrow([], ternary)])));
			} else if (value.type === 'ObjectPattern' || value.type === 'ArrayPattern') {
				emitDerivedBindings(value, accessExpr, out);
			}
		}
	} else if (pattern.type === 'ArrayPattern') {
		for (let i = 0; i < ((pattern as any).elements || []).length; i++) {
			const elem = (pattern as any).elements[i];
			if (!elem) continue;
			if (elem.type === 'RestElement' && elem.argument?.type === 'Identifier') {
				out.push(b.declarator(b.id(elem.argument.name), b.call('$.derived', [b.arrow([], sliceCall(baseExpr, i))])));
				continue;
			}
			const accessExpr = memberComputed(baseExpr, i);
			if (elem.type === 'Identifier') {
				out.push(b.declarator(b.id(elem.name), b.call('$.derived', [b.arrow([], accessExpr)])));
			} else if (elem.type === 'AssignmentPattern' && elem.left?.type === 'Identifier') {
				const cond = b.binary('!==', accessExpr, b.id('undefined'));
				const ternary = { type: 'ConditionalExpression', test: cond, consequent: accessExpr, alternate: elem.right, start: 0, end: 0, loc: null } as any;
				out.push(b.declarator(b.id(elem.left.name), b.call('$.derived', [b.arrow([], ternary)])));
			} else if (elem.type === 'ObjectPattern' || elem.type === 'ArrayPattern') {
				emitDerivedBindings(elem, accessExpr, out);
			}
		}
	}
}

function buildObjectRest(baseExpr: AstNode, excludeKeys: string[], restName: string): AstNode {
	const restId = b.id(restName);
	const props: AstNode[] = excludeKeys.map(k => ({
		type: 'Property', key: b.id(k), value: b.id(k), kind: 'init', shorthand: true, computed: false, method: false, start: 0, end: 0, loc: null
	} as any));
	props.push({ type: 'RestElement', argument: restId, start: 0, end: 0, loc: null } as any);
	const param = { type: 'ObjectPattern', properties: props, start: 0, end: 0, loc: null } as any;
	const arrow = b.arrow([param], restId);
	const paren = { type: 'ParenthesizedExpression', expression: arrow, start: 0, end: 0, loc: null } as any;
	return b.call(paren, [baseExpr]);
}

// ── Identifier & Assignment Transforms ─────────────────────────────

function transformShorthandProperty(node: Extract<AstNode, { type: 'Property' }>, state: TransformState, next: WalkContext['next']) {
	if (!node.shorthand) return next();
	const key = node.key;
	if (key.type !== 'Identifier') return next();
	const binding = state.scope.get(key.name);
	if (!binding?.reactive) return next();

	if (state.insideDerived) return b.prop(key.name, b.call('$.get', [b.id(key.name)]));
	return b.getter(key.name, [b.returnStmt(b.call('$.get', [b.id(key.name)]))]);
}

function transformIdentifier(node: AstNode, state: TransformState, path: AstNode[]) {
	if (node.type !== 'Identifier') return;
	const binding = state.scope.get(node.name);
	if (!binding?.reactive) return;

	const parent = path.at(-1);
	if (!parent) return b.call('$.get', [node]);

	// Skip declaration/write positions
	if (parent.type === 'AssignmentExpression' && parent.left === node) return;
	if (parent.type === 'UpdateExpression') return;
	if (parent.type === 'VariableDeclarator' && parent.id === node) return;
	if (parent.type === 'FunctionDeclaration' && parent.id === node) return;
	if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier') return;
	if (parent.type === 'RestElement') return;
	if ((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' || parent.type === 'ArrowFunctionExpression') &&
		parent.params.some(p => p.type === 'Identifier' && p.name === node.name)) return;

	// Skip non-computed property keys
	if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
	if (parent.type === 'Property' && parent.key === node && !parent.computed) return;

	// Direct member access (proxy/derived/bind-prop)
	if (parent.type === 'MemberExpression' && parent.object === node && binding.directMemberAccess) return;
	if (parent.type === 'CallExpression' && parent.callee === node && binding.directMemberAccess) return;

	// Signal forwarding
	if (isInReactiveCallArg(node, path, state.reactiveCallTargets)) return;

	// Shorthand properties handled by Property visitor
	if (parent.type === 'Property' && parent.shorthand && parent.value === node) return;

	// Derived signals returned from non-component functions
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

function transformReactiveCallOrNext(node: CallExpression, state: TransformState, next: WalkContext['next']) {
	if (node.callee.type !== 'Identifier') return next();
	const fn = node.callee.name;
	const reactiveIndices = state.reactiveCallTargets.get(fn);
	if (!reactiveIndices || reactiveIndices.size === 0) return next();

	const result = next();
	const transformed = result ?? node;
	if (transformed.type !== 'CallExpression') return result;

	const args = [...transformed.arguments];
	let changed = false;

	for (const idx of reactiveIndices) {
		if (idx >= args.length) continue;
		const arg = args[idx];
		const original = node.arguments[idx];

		if (original && original.type === 'ArrayExpression') {
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
			args[idx] = b.call('$.derived', [b.arrow([], arg)]);
			changed = true;
		}
	}

	return changed ? { ...transformed, arguments: args } : result;
}

function memberRootIsCallbackParam(expr: Expression, state: TransformState): boolean {
	let node: Expression = expr;
	while (node.type === 'MemberExpression') node = node.object;
	if (node.type !== 'Identifier') return false;
	const binding = state.scope.get(node.name);
	if (!binding) return false;
	return binding.scope !== state.component?.scope && binding.kind === 'normal';
}

function isMemberOnReactive(node: Expression, state: TransformState): boolean {
	if (node.type === 'Identifier') return !!state.scope.get(node.name)?.reactive;
	if (node.type === 'MemberExpression') return isMemberOnReactive(node.object, state);
	return false;
}

// ── JSX Transform ──────────────────────────────────────────────────

function transformJSXElement(node: JSXElement, state: TransformState, visit: WalkContext['visit']) {
	const opening = node.openingElement;
	const tagName = getTagName(opening.name);

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
			if (Array.isArray(attrResult)) props.push(...attrResult);
			else props.push(attrResult);
		}
	}

	// Scope attrs for scoped CSS
	if (!isComponent && state.processedStyles.length > 0) {
		const attrs = computeScopeAttrsForElement(state.processedStyles, state.elementPath);
		if (attrs.length > 0) props.push(b.prop(SCOPE_ATTR, b.literal(attrs.join(' '))));
	} else if (!isComponent && state.scopeAttrs.length > 0) {
		props.push(b.prop(SCOPE_ATTR, b.literal(state.scopeAttrs.join(' '))));
	}

	// CSS vars style prop
	if (!isComponent && state.cssVars.length > 0) {
		const parseCSSVarExpr = (exprStr: string): Expression | null => {
			const parsed = parseSync('x.ts', `(${exprStr})`, { sourceType: 'module' });
			const firstStmt = parsed.program.body[0];
			if (!firstStmt || firstStmt.type !== 'ExpressionStatement') return null;
			let expr: Expression = firstStmt.expression;
			while (expr.type === 'ParenthesizedExpression') expr = expr.expression;
			return expr;
		};
		const styleProps = state.cssVars.map(cv => {
			let valueExpr: AstNode = b.id(cv.expr);
			const parsed = parseCSSVarExpr(cv.expr);
			if (parsed) valueExpr = walkNode(parsed, state);
			if (cv.suffix) valueExpr = b.binary('+', valueExpr, b.literal(cv.suffix));
			return b.prop(cv.varName, valueExpr);
		});
		const isReactive = state.cssVars.some(cv => {
			const expr = parseCSSVarExpr(cv.expr);
			return expr ? expressionIsReactive(expr, state) : false;
		});
		props.push(isReactive ? b.getter('style', [b.returnStmt(b.object(styleProps))]) : b.prop('style', b.object(styleProps)));
	}

	// Children
	if (!opening.selfClosing) {
		const childState: TransformState = { ...state, nsContext: childNs };
		const children = transformJSXChildren(node.children, childState, visit, true);
		if (children.length > 0) props.push(b.prop('children', b.array(children)));
	}

	const tag = isComponent ? b.id(tagName) : b.literal(tagName);
	const factory = selfNs === 'svg' ? '$.svg' : selfNs === 'math' ? '$.math' : '$.jsx';
	if (props.length === 0) return b.call(factory, [tag]);

	if (props.some(p => p.type === 'SpreadElement')) {
		return b.call(factory, [tag, b.call('$.mergeProps', buildMergeSources(props))]);
	}
	return b.call(factory, [tag, b.object(props)]);
}

function buildMergeSources(props: AstNode[]): AstNode[] {
	const sources: AstNode[] = [];
	let current: AstNode[] = [];
	for (const prop of props) {
		if (prop.type === 'SpreadElement') {
			if (current.length > 0) { sources.push(b.object(current)); current = []; }
			sources.push(prop.argument);
		} else {
			current.push(prop);
		}
	}
	if (current.length > 0) sources.push(b.object(current));
	return sources;
}

function transformJSXAttribute(attr: JSXAttribute, state: TransformState) {
	const attrName = getAttrName(attr.name);

	// bind: namespace
	if (attr.name.type === 'JSXNamespacedName') {
		const ns = attr.name.namespace.name;
		const local = attr.name.name.name;

		if (ns === 'bind') {
			let expr = attr.value?.type === 'JSXExpressionContainer' ? attr.value.expression : null;
			if (expr && expr.type !== 'JSXEmptyExpression') {
				const inner = unwrapIIFEExpr(expr as AstNode);
				if (inner) expr = inner as any;
			}
			if (expr && expr.type !== 'JSXEmptyExpression' && expr.type === 'ArrayExpression' && expr.elements.length === 2) {
				const [el0, el1] = expr.elements;
				if (el0 && el1) {
					return [buildBindGetter(local, walkNode(el0, state)), buildBindSetter(local, walkNode(el1, state))].filter(Boolean) as AstNode[];
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
				return [b.getter(local, [b.returnStmt(getExpr)]), b.setter(local, b.id('v'), [setBody])];
			}
			return null;
		}
	}

	// Boolean
	if (attr.value === null && attr.name.type === 'JSXIdentifier') return b.prop(attrName, b.literal(true));

	// Static string
	if (attr.value?.type === 'Literal') return b.prop(attrName, b.literal(attr.value.value));

	// Dynamic
	if (attr.value?.type === 'JSXExpressionContainer') {
		const expr = attr.value.expression;
		if (expr.type === 'JSXEmptyExpression') return null;

		if (expr.type === 'AssignmentExpression' || expr.type === 'UpdateExpression') {
			return b.prop(attrName, b.arrow([], walkNode(expr, state)));
		}

		const isReactive = expressionIsReactive(expr, state);
		if (isReactive) {
			const transformed = walkNode(expr, { ...state, insideDerived: true });
			return b.getter(attrName, [b.returnStmt(transformed)]);
		}
		return b.prop(attrName, walkNode(expr, state));
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
				const prev = i > 0 ? children[i - 1] : null;
				const next = i < children.length - 1 ? children[i + 1] : null;
				const prevIsElement = prev?.type === 'JSXElement';
				const nextIsElement = next?.type === 'JSXElement';
				const isCF = (n: JSXChild | null) => {
					if (!n || n.type !== 'JSXExpressionContainer') return false;
					const iifeBody = unwrapIIFE(n.expression as AstNode);
					if (iifeBody && iifeBody.length >= 1) {
						const first = iifeBody[0];
						return first && (first.type === 'IfStatement' || first.type === 'ForOfStatement' ||
							first.type === 'ForInStatement' || first.type === 'ForStatement' ||
							first.type === 'SwitchStatement' || first.type === 'TryStatement');
					}
					return false;
				};
				if ((prevIsElement && nextIsElement) || (prevIsElement && isCF(next)) ||
					(isCF(prev) && nextIsElement) || (isCF(prev) && isCF(next)) || isFirst || isLast) continue;
			}
			result.push(b.literal(text));
			continue;
		}

		if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
			if (child.type === 'JSXElement' && getTagName(child.openingElement.name).startsWith(STYLE_MARKER_PREFIX)) continue;
			const childState = trackElementPath ? { ...state, elementPath: [...state.elementPath, elementIdx] } : state;
			result.push(walkNode(child, childState));
			elementIdx++;
			continue;
		}

		if (child.type === 'JSXExpressionContainer') {
			let expr = child.expression;
			if (expr.type === 'JSXEmptyExpression') continue;

			// IIFE → control flow
			const iifeBody = unwrapIIFE(expr);
			if (iifeBody) { result.push(transformIIFEBody(iifeBody, state)); continue; }

			// __html
			if (expr.type === 'CallExpression' && expr.callee.type === 'Identifier' && expr.callee.name === '__html') {
				result.push(walkNode(expr, state)); continue;
			}

			// Nested JSX
			if (expr.type === 'JSXElement' || expr.type === 'JSXFragment') { result.push(walkNode(expr, state)); continue; }

			// Ternary → $.if
			if (expr.type === 'ConditionalExpression' && isJSXExpr(expr.consequent) && (isJSXExpr(expr.alternate) || isNullish(expr.alternate))) {
				result.push(transformTernaryToIf(expr, state)); continue;
			}

			// && → $.if
			if (expr.type === 'LogicalExpression' && expr.operator === '&&' && isJSXExpr(expr.right)) {
				result.push(transformLogicalAndToIf(expr, state)); continue;
			}

			// .map() → $.for
			if (expr.type === 'CallExpression' && expr.callee.type === 'MemberExpression' &&
				expr.callee.property.type === 'Identifier' && expr.callee.property.name === 'map') {
				const callback = expr.arguments[0];
				if (callback && (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') &&
					callback.body && callback.body.type !== 'BlockStatement' && isJSXBody(callback.body)) {
					result.push(transformMapToFor(expr, state)); continue;
				}
			}

			// Regular expression child
			const transformed = walkNode(expr, state);
			const shouldThunk = expressionIsReactive(expr, state)
				|| (expr.type === 'MemberExpression' && !memberRootIsCallbackParam(expr, state));
			result.push(shouldThunk ? b.arrow([], transformed) : transformed);
			continue;
		}

		result.push(walkNode(child, state));
	}
	return result;
}

// ── Control Flow Transforms ────────────────────────────────────────

function transformHtmlCall(node: CallExpression, state: TransformState) {
	const arg = node.arguments[0];
	if (!arg || arg.type === 'SpreadElement') return b.literal(null);
	return b.call('$.html', [b.arrow([], walkNode(arg, state))]);
}

/** Unwrap IIFE: (() => { ...body... })() → body */
function unwrapIIFE(expr: AstNode): AstNode[] | null {
	if (expr.type !== 'CallExpression') return null;
	if ((expr as any).arguments.length !== 0) return null;
	let callee = (expr as any).callee;
	if (callee.type === 'ParenthesizedExpression') callee = callee.expression;
	if (callee.type !== 'ArrowFunctionExpression') return null;
	if (callee.params.length !== 0) return null;
	if (callee.body.type !== 'BlockStatement') return null;
	return callee.body.body as AstNode[];
}

function unwrapIIFEExpr(expr: AstNode): AstNode | null {
	const body = unwrapIIFE(expr);
	if (!body || body.length !== 1) return null;
	const stmt = body[0];
	if (stmt.type === 'ExpressionStatement') return stmt.expression;
	if (stmt.type === 'ReturnStatement' && stmt.argument) return stmt.argument;
	return null;
}

/** Convert IIFE body into runtime call */
function transformIIFEBody(body: AstNode[], state: TransformState): AstNode {
	if (body.length === 1) {
		const stmt = body[0];
		if (stmt.type === 'IfStatement') return transformIfStatement(stmt, state);
		if (stmt.type === 'ForOfStatement' || stmt.type === 'ForInStatement' || stmt.type === 'ForStatement') return transformForStatement(stmt, state);
		if (stmt.type === 'SwitchStatement') return transformSwitchStatement(stmt, state);
		if (stmt.type === 'TryStatement') return transformTryStatement(stmt, state);
		if (stmt.type === 'ExpressionStatement') {
			const innerExpr = stmt.expression;
			if (innerExpr.type === 'JSXElement' || innerExpr.type === 'JSXFragment') return walkNode(innerExpr, state);
			if (innerExpr.type === 'ConditionalExpression' && isJSXExpr(innerExpr.consequent) && (isJSXExpr(innerExpr.alternate) || isNullish(innerExpr.alternate)))
				return transformTernaryToIf(innerExpr, state);
			if (innerExpr.type === 'LogicalExpression' && innerExpr.operator === '&&' && isJSXExpr(innerExpr.right))
				return transformLogicalAndToIf(innerExpr, state);
			if (innerExpr.type === 'CallExpression' && innerExpr.callee.type === 'MemberExpression' &&
				innerExpr.callee.property.type === 'Identifier' && innerExpr.callee.property.name === 'map') {
				const callback = innerExpr.arguments[0];
				if (callback && (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') &&
					callback.body && callback.body.type !== 'BlockStatement' && isJSXBody(callback.body))
					return transformMapToFor(innerExpr as any, state);
			}
			const transformed = walkNode(innerExpr, state);
			const shouldThunk = expressionIsReactive(innerExpr, state)
				|| (innerExpr.type === 'MemberExpression' && !memberRootIsCallbackParam(innerExpr, state));
			return shouldThunk ? b.arrow([], transformed) : transformed;
		}
		if (stmt.type === 'ReturnStatement' && stmt.argument) {
			const arg = stmt.argument;
			if (arg.type === 'IfStatement') return transformIfStatement(arg as any, state);
			if (arg.type === 'JSXElement' || arg.type === 'JSXFragment') return walkNode(arg, state);
			if (arg.type === 'ConditionalExpression' && isJSXExpr(arg.consequent) && (isJSXExpr(arg.alternate) || isNullish(arg.alternate)))
				return transformTernaryToIf(arg, state);
			if (arg.type === 'LogicalExpression' && arg.operator === '&&' && isJSXExpr(arg.right))
				return transformLogicalAndToIf(arg, state);
			if (arg.type === 'CallExpression' && arg.callee.type === 'MemberExpression' &&
				arg.callee.property.type === 'Identifier' && arg.callee.property.name === 'map') {
				const callback = arg.arguments[0];
				if (callback && (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') &&
					callback.body && callback.body.type !== 'BlockStatement' && isJSXBody(callback.body))
					return transformMapToFor(arg as any, state);
			}
			const transformed = walkNode(arg, state);
			const shouldThunk = expressionIsReactive(arg, state)
				|| (arg.type === 'MemberExpression' && !memberRootIsCallbackParam(arg, state));
			return shouldThunk ? b.arrow([], transformed) : transformed;
		}
	}

	if (body.length > 1) {
		const lastStmt = body[body.length - 1];
		if (lastStmt.type === 'IfStatement' || lastStmt.type === 'ForOfStatement' ||
			lastStmt.type === 'ForInStatement' || lastStmt.type === 'ForStatement' ||
			lastStmt.type === 'SwitchStatement' || lastStmt.type === 'TryStatement') {
			const preamble = body.slice(0, -1).map(s => walkNode(s, state));
			let cfNode: AstNode;
			if (lastStmt.type === 'IfStatement') cfNode = transformIfStatement(lastStmt, state);
			else if (lastStmt.type === 'ForOfStatement' || lastStmt.type === 'ForInStatement' || lastStmt.type === 'ForStatement') cfNode = transformForStatement(lastStmt, state);
			else if (lastStmt.type === 'SwitchStatement') cfNode = transformSwitchStatement(lastStmt, state);
			else cfNode = transformTryStatement(lastStmt as any, state);
			return b.arrowBlock([], [...preamble, { type: 'ReturnStatement', argument: cfNode } as unknown as AstNode]);
		}
		if (lastStmt.type === 'ReturnStatement') return b.arrowBlock([], body.map(s => walkNode(s, state)));
	}

	return b.arrowBlock([], body.map(s => walkNode(s, state)));
}

function transformIfStatement(node: AstNode, state: TransformState): AstNode {
	if (node.type !== 'IfStatement') return b.literal(null);
	const condExpr = walkNode(node.test, state);
	const trueBranch = statementsToArrow(node.consequent, state);
	const args: AstNode[] = [b.arrow([], condExpr), trueBranch];

	if (node.alternate) {
		if (node.alternate.type === 'IfStatement') args.push(b.arrow([], transformIfStatement(node.alternate, state)));
		else args.push(statementsToArrow(node.alternate, state));
	}
	return b.call('$.if', args);
}

function transformForStatement(node: AstNode, state: TransformState): AstNode {
	if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
		const collection = node.type === 'ForOfStatement'
			? walkNode(node.right, state)
			: b.call('Object.keys', [walkNode(node.right, state)]);
		const param = extractForParam(node.left);

		let bodyNode = node.body;
		let indexParam: AstNode | null = null;
		let keyExpr: AstNode | null = null;

		if (bodyNode.type === 'BlockStatement') {
			const stmts = (bodyNode.body as AstNode[]).slice();
			if (stmts.length > 0 && stmts[0].type === 'VariableDeclaration' && stmts[0].kind === 'let') {
				const decl = stmts[0].declarations[0];
				if (decl && decl.id.type === 'Identifier' && decl.init && decl.init.type === 'Literal' && decl.init.value === 0) {
					indexParam = b.id(decl.id.name);
					stmts.shift();
				}
			}
			if (stmts.length > 0 && stmts[0].type === 'ExpressionStatement') {
				const expr = stmts[0].expression;
				if (expr.type !== 'JSXElement' && expr.type !== 'JSXFragment' && expr.type !== 'CallExpression') {
					keyExpr = walkNode(expr, state);
					stmts.shift();
				}
			}
			(bodyNode as any).body = stmts;
		}

		const allParams = indexParam ? [...param, indexParam] : param;
		const bodyCallback = transformForBody(bodyNode, state, allParams);
		const args: AstNode[] = [b.arrow([], collection), bodyCallback];
		if (keyExpr) args.push(b.arrow(param, keyExpr));
		return b.call('$.for', args);
	}

	if (node.type === 'ForStatement') {
		const initSrc = node.init ? walkNode(node.init, state) : b.literal(null);
		const testSrc = node.test ? walkNode(node.test, state) : b.literal(true);
		const updateSrc = node.update ? walkNode(node.update, state) : b.literal(null);
		let loopVar = '__i';
		if (node.init?.type === 'VariableDeclaration' && node.init.declarations[0]) {
			const decl = node.init.declarations[0];
			if (decl.id.type === 'Identifier') loopVar = decl.id.name;
		}
		const collectionBody = [
			{ type: 'VariableDeclaration', kind: 'const', declarations: [{ type: 'VariableDeclarator', id: b.id('__a'), init: b.array([]) }] },
			{ type: 'ForStatement', init: initSrc, test: testSrc, update: updateSrc, body: { type: 'ExpressionStatement', expression: b.call('__a.push', [b.id(loopVar)]) } },
			{ type: 'ReturnStatement', argument: b.id('__a') }
		] as unknown as AstNode[];
		const bodyCallback = transformForBody(node.body, state, [b.id(loopVar)]);
		return b.call('$.for', [b.arrowBlock([], collectionBody), bodyCallback]);
	}
	return b.literal(null);
}

function transformSwitchStatement(node: AstNode, state: TransformState): AstNode {
	if (node.type !== 'SwitchStatement') return b.literal(null);
	const discriminant = walkNode(node.discriminant, state);

	const cases: AstNode[] = [];
	let pendingValues: AstNode[] = [];
	for (const sc of node.cases) {
		if (sc.test) pendingValues.push(walkNode(sc.test, state));
		const bodyStmts = (sc.consequent || []).filter((s: AstNode) => s.type !== 'BreakStatement');
		if (bodyStmts.length === 0) continue;
		const valuesExpr = pendingValues.length > 0 ? b.array(pendingValues) : b.literal(null);
		const fn = statementsToArrowCompact(bodyStmts, state);
		cases.push(b.object([b.prop('values', valuesExpr), b.prop('fn', fn)]));
		pendingValues = [];
	}
	return b.call('$.switch', [b.arrow([], discriminant), b.array(cases)]);
}

function transformTryStatement(node: AstNode, state: TransformState): AstNode {
	if (node.type !== 'TryStatement') return b.literal(null);

	let tryStmts = node.block.body as AstNode[];
	let pendingCallback: AstNode | null = null;
	if (tryStmts.length > 0 && tryStmts[0].type === 'VariableDeclaration') {
		const decl = tryStmts[0].declarations?.[0];
		if (decl && decl.id?.type === 'Identifier' && decl.id.name === '__pending' && decl.init) {
			pendingCallback = walkNode(decl.init, state);
			tryStmts = tryStmts.slice(1);
		}
	}

	const tryBody = statementsToArrowBasic(tryStmts, state);
	const args: AstNode[] = [tryBody];

	if (node.handler) {
		const param = node.handler.param?.type === 'Identifier' ? [b.id(node.handler.param.name)] : [];
		args.push(statementsToArrowBasic(node.handler.body.body, state, param));
	}

	if (pendingCallback) {
		if (!node.handler) args.push(b.id('undefined'));
		args.push(pendingCallback);
	}

	if (node.finalizer) {
		if (!node.handler && !pendingCallback) args.push(b.id('undefined'));
		if (!pendingCallback) args.push(b.id('undefined'));
		args.push(statementsToArrowBasic(node.finalizer.body, state));
	}
	return b.call('$.try', args);
}

// ── Shared Control Flow Helpers ────────────────────────────────────

function extractForParam(left: AstNode): AstNode[] {
	if (left.type === 'VariableDeclaration' && left.declarations[0]) {
		const decl = left.declarations[0];
		if (decl.id.type === 'Identifier') return [b.id(decl.id.name)];
		return [decl.id as unknown as AstNode];
	}
	if (left.type === 'Identifier') return [b.id(left.name)];
	return [b.id('item')];
}

function transformForBody(body: AstNode, state: TransformState, params: AstNode[]): AstNode {
	if (body.type === 'BlockStatement') {
		const stmts = body.body as AstNode[];
		const blockScope = state.analysis.scopes.get(body);
		const innerState = blockScope ? { ...state, scope: blockScope } : state;

		if (stmts.length === 1 && stmts[0].type === 'ReturnStatement' && stmts[0].argument) {
			const iifeBody = unwrapIIFE(stmts[0].argument);
			if (iifeBody) return b.arrowBlock(params, [b.returnStmt(transformIIFEBody(iifeBody, innerState))]);
		}

		return b.arrowBlock(params, stmts.map((s: AstNode) => walkNode(s, innerState)));
	}
	if (body.type === 'ExpressionStatement') return b.arrow(params, walkNode(body.expression, state));
	return b.arrow(params, walkNode(body, state));
}

/** Convert a body node (BlockStatement or expression) to an arrow callback */
function statementsToArrow(body: AstNode, state: TransformState): AstNode {
	if (body.type === 'BlockStatement') {
		const stmts = body.body as AstNode[];
		if (stmts.length === 1) {
			const s = stmts[0];
			if (s.type === 'IfStatement') return b.arrow([], transformIfStatement(s, state));
			if (s.type === 'ForOfStatement' || s.type === 'ForInStatement' || s.type === 'ForStatement')
				return b.arrow([], transformForStatement(s, state));
			if (s.type === 'ReturnStatement' && s.argument) {
				let arg = s.argument;
				while (arg.type === 'ParenthesizedExpression') arg = arg.expression;
				return b.arrow([], walkNode(arg, state));
			}
			if (s.type === 'ExpressionStatement') {
				const expr = s.expression;
				if (expr.type === 'JSXElement' || expr.type === 'JSXFragment') return b.arrow([], walkNode(expr, state));
			}
		}
		return b.arrowBlock([], stmts.map((s: AstNode) => walkNode(s, state)));
	}
	if (body.type === 'ExpressionStatement') return b.arrow([], walkNode(body.expression, state));
	return b.arrow([], walkNode(body, state));
}

/** Convert statement array to arrow (return-only optimization) */
function statementsToArrowBasic(stmts: AstNode[], state: TransformState, params: AstNode[] = []): AstNode {
	if (stmts.length === 1 && stmts[0].type === 'ReturnStatement' && stmts[0].argument) {
		return b.arrow(params, walkNode(stmts[0].argument, state));
	}
	return b.arrowBlock(params, stmts.map(s => walkNode(s, state)));
}

/** Convert statement array to arrow (compact: also optimizes single JSX expressions) */
function statementsToArrowCompact(stmts: AstNode[], state: TransformState, params: AstNode[] = []): AstNode {
	if (stmts.length === 1) {
		const s = stmts[0];
		if (s.type === 'ReturnStatement' && s.argument) return b.arrow(params, walkNode(s.argument, state));
		if (s.type === 'ExpressionStatement') {
			const expr = s.expression;
			if (expr.type === 'JSXElement' || expr.type === 'JSXFragment') return b.arrow(params, walkNode(expr, state));
		}
	}
	return b.arrowBlock(params, stmts.map(s => walkNode(s, state)));
}

// ── JSX Pattern Transforms ─────────────────────────────────────────

function transformTernaryToIf(expr: Expression, state: TransformState) {
	if (expr.type !== 'ConditionalExpression') return b.literal(null);
	const args = [b.arrow([], walkNode(expr.test, state)), b.arrow([], walkNode(unwrapParen(expr.consequent), state))];
	if (!isNullish(expr.alternate)) args.push(b.arrow([], walkNode(unwrapParen(expr.alternate), state)));
	return b.call('$.if', args);
}

function transformLogicalAndToIf(expr: Expression, state: TransformState) {
	if (expr.type !== 'LogicalExpression') return b.literal(null);
	return b.call('$.if', [b.arrow([], walkNode(expr.left, state)), b.arrow([], walkNode(unwrapParen(expr.right), state))]);
}

function transformMapToFor(expr: CallExpression, state: TransformState) {
	if (expr.callee.type !== 'MemberExpression') return b.literal(null);
	const collection = walkNode(expr.callee.object, state);
	const callback = expr.arguments[0];
	if (!callback || (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression'))
		return b.call('$.for', [b.arrow([], collection), b.arrow([], b.literal(null))]);

	const params = callback.params.map((p: ParamPattern) => p.type === 'Identifier' ? b.id(p.name) : b.id('item'));
	const callbackBody = callback.body?.type === 'BlockStatement'
		? b.arrowBlock(params, callback.body.body.map((s: AstNode) => walkNode(s, state)))
		: b.arrow(params, walkNode(unwrapParen(callback.body!), state));
	return b.call('$.for', [b.arrow([], collection), callbackBody]);
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
	// Check if there are JSX nodes outside of component functions
	function containsJsx(node: any): boolean {
		if (!node || typeof node !== 'object') return false;
		if (node.type === 'JSXElement' || node.type === 'JSXFragment') return true;
		for (const key of Object.keys(node)) {
			if (key === 'type' || key === 'start' || key === 'end') continue;
			const val = node[key];
			if (Array.isArray(val)) {
				for (const item of val) {
					if (item && typeof item === 'object' && containsJsx(item)) return true;
				}
			} else if (val && typeof val === 'object' && containsJsx(val)) {
				return true;
			}
		}
		return false;
	}

	if (program.type !== 'Program' || !('body' in program)) return false;
	for (const stmt of (program as any).body) {
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
			for (const idx of indices) {
				const arg = ancestor.arguments[idx];
				if (arg && node.start >= arg.start && node.end <= arg.end) return true;
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

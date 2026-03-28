/**
 * Phase 2 — Analyze
 *
 * Walks the OXC AST and, using metadata from the pre-processor,
 * produces an Intermediate Representation (IR) for each component.
 */
import type { ComponentMeta, PreprocessResult } from '../1-parse';

// ── IR Types ───────────────────────────────────────────────────────

export interface ComponentIR {
    meta: ComponentMeta;
    params: ParamIR[];
    stateVars: { name: string; initExpr: string }[];
    derivedVars: { name: string; expr: string }[];
    /** All variable names that are reactive (state + derived + bind props) */
    reactiveVars: Set<string>;
    jsx: JSXNodeIR;
    /** Raw non-JSX statements between state/derived and render (to preserve) */
    bodyStatements: string[];
}

export interface ParamIR {
    name: string;
    isBind: boolean;
    isRest: boolean;
    defaultValue: string | null;
}

// ── JSX IR Types ───────────────────────────────────────────────────

export type JSXNodeIR =
    | JSXElementIR
    | JSXFragmentIR
    | JSXTextIR
    | JSXExpressionIR
    | JSXIfBlockIR
    | JSXForBlockIR;

export interface JSXElementIR {
    type: 'element';
    tag: string;
    isComponent: boolean;
    selfClosing: boolean;
    attributes: JSXAttrIR[];
    children: JSXNodeIR[];
}

export interface JSXFragmentIR {
    type: 'fragment';
    children: JSXNodeIR[];
}

export interface JSXTextIR {
    type: 'text';
    value: string;
}

export interface JSXExpressionIR {
    type: 'expression';
    /** Raw source text of the expression */
    raw: string;
}

export interface JSXIfBlockIR {
    type: 'if_block';
    /** Raw condition expression */
    condition: string;
    /** Children for the true branch */
    trueBranch: JSXNodeIR[];
    /** Children for the false branch (null if no else) */
    falseBranch: JSXNodeIR[] | null;
}

export interface JSXForBlockIR {
    type: 'for_block';
    /** Raw collection expression */
    collection: string;
    /** Loop item variable name */
    itemName: string;
    /** Optional index variable name */
    indexName: string | null;
    /** Optional key expression */
    keyExpr: string | null;
    /** Children for the loop body */
    body: JSXNodeIR[];
}

export interface JSXAttrIR {
    kind: 'static' | 'dynamic' | 'bind' | 'event' | 'shorthand' | 'spread';
    name: string;
    /** For bind: the property being bound (e.g. 'value', 'checked') */
    bindProperty?: string;
    /** Static attribute value string, or raw expression source */
    value: string | null;
}

// ── Analyze ────────────────────────────────────────────────────────

export function analyze(
    ast: any,
    source: string,
    meta: PreprocessResult,
): ComponentIR[] {
    const components: ComponentIR[] = [];
    const componentNames = new Set(meta.components.map((c) => c.name));
    const stateSet = new Set(meta.stateVars);
    const derivedSet = new Set(meta.derivedVars);
    const stateImportSet = new Set(meta.stateImports);

    for (const node of ast.body) {
        const fn = extractFunctionDecl(node);
        if (!fn) continue;
        if (!componentNames.has(fn.name)) continue;

        const compMeta = meta.components.find((c) => c.name === fn.name)!;
        const ir = analyzeComponent(fn, compMeta, source, stateSet, derivedSet, stateImportSet);
        components.push(ir);
    }

    return components;
}

// ── Helpers ────────────────────────────────────────────────────────

interface FnInfo {
    name: string;
    node: any;
    params: any[];
    body: any;
}

function extractFunctionDecl(node: any): FnInfo | null {
    // Regular function declaration
    if (node.type === 'FunctionDeclaration' && node.id) {
        return { name: node.id.name, node, params: node.params, body: node.body };
    }
    // export default function X() {}
    if (node.type === 'ExportDefaultDeclaration' && node.declaration?.type === 'FunctionDeclaration') {
        const fn = node.declaration;
        return { name: fn.id?.name || 'default', node: fn, params: fn.params, body: fn.body };
    }
    // export function X() {}
    if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration') {
        const fn = node.declaration;
        return { name: fn.id.name, node: fn, params: fn.params, body: fn.body };
    }
    return null;
}

function analyzeComponent(
    fn: FnInfo,
    compMeta: ComponentMeta,
    source: string,
    stateSet: Set<string>,
    derivedSet: Set<string>,
    stateImportSet: Set<string>,
): ComponentIR {
    const params: ParamIR[] = [];
    const stateVars: { name: string; initExpr: string }[] = [];
    const derivedVars: { name: string; expr: string }[] = [];
    const reactiveVars = new Set<string>([...stateImportSet]);
    const bodyStatements: string[] = [];
    let jsx: JSXNodeIR | null = null;

    // Analyze params
    for (const param of fn.params) {
        const p = analyzeParam(param, source);
        params.push(p);
        // All non-rest props are reactive (wrapped in $.prop → derived signal)
        if (!p.isRest) {
            reactiveVars.add(p.name);
        }
    }

    // Walk the function body
    if (fn.body?.type === 'FunctionBody' || fn.body?.type === 'BlockStatement') {
        for (const stmt of fn.body.statements || fn.body.body || []) {
            if (stmt.type === 'VariableDeclaration') {
                for (const decl of stmt.declarations) {
                    const name = decl.id?.name;
                    if (!name) continue;

                    if (stateSet.has(name)) {
                        const initExpr = decl.init ? source.slice(decl.init.start, decl.init.end) : 'undefined';
                        stateVars.push({ name, initExpr });
                        reactiveVars.add(name);
                    } else if (derivedSet.has(name)) {
                        const expr = decl.init ? source.slice(decl.init.start, decl.init.end) : 'undefined';
                        derivedVars.push({ name, expr });
                        reactiveVars.add(name);
                    } else {
                        // Normal variable — preserve
                        bodyStatements.push(source.slice(stmt.start, stmt.end));
                    }
                }
            } else if (stmt.type === 'ReturnStatement' && stmt.argument) {
                // This was a `render (...)` block, now `return (<>...</>)`
                // Unwrap ParenthesizedExpression if present
                let jsxNode = stmt.argument;
                while (jsxNode.type === 'ParenthesizedExpression') {
                    jsxNode = jsxNode.expression;
                }
                jsx = analyzeJSXNode(jsxNode, source);
            } else {
                // Other statements — preserve as-is
                bodyStatements.push(source.slice(stmt.start, stmt.end));
            }
        }
    }

    if (!jsx) {
        jsx = { type: 'fragment', children: [] };
    }

    return { meta: compMeta, params, stateVars, derivedVars, reactiveVars, jsx, bodyStatements };
}

function analyzeParam(param: any, source: string): ParamIR {
    if (param.type === 'RestElement') {
        return {
            name: param.argument?.name || 'rest',
            isBind: false,
            isRest: true,
            defaultValue: null,
        };
    }
    if (param.type === 'AssignmentPattern') {
        return {
            name: param.left?.name || 'unknown',
            isBind: false,
            isRest: false,
            defaultValue: source.slice(param.right.start, param.right.end),
        };
    }
    if (param.type === 'Identifier') {
        return {
            name: param.name,
            isBind: false,
            isRest: false,
            defaultValue: null,
        };
    }
    // Fallback
    return { name: 'unknown', isBind: false, isRest: false, defaultValue: null };
}

// ── JSX Analysis ───────────────────────────────────────────────────

function analyzeJSXNode(node: any, source: string): JSXNodeIR {
    switch (node.type) {
        case 'JSXElement':
            return analyzeJSXElement(node, source);
        case 'JSXFragment':
            return analyzeJSXFragment(node, source);
        case 'JSXText':
            return { type: 'text', value: node.value };
        case 'JSXExpressionContainer': {
            const expr = node.expression;
            // Detect __if() calls
            if (
                expr.type === 'CallExpression' &&
                expr.callee?.type === 'Identifier' &&
                expr.callee.name === '__if'
            ) {
                return analyzeIfBlock(expr, source);
            }
            // Detect __for() calls
            if (
                expr.type === 'CallExpression' &&
                expr.callee?.type === 'Identifier' &&
                expr.callee.name === '__for'
            ) {
                return analyzeForBlock(expr, source);
            }
            return {
                type: 'expression',
                raw: source.slice(expr.start, expr.end),
            };
        }
        default:
            // Fallback: treat as text
            return { type: 'text', value: '' };
    }
}

function analyzeJSXFragment(node: any, source: string): JSXFragmentIR {
    return {
        type: 'fragment',
        children: (node.children || []).map((c: any) => analyzeJSXNode(c, source)),
    };
}

function analyzeJSXElement(node: any, source: string): JSXElementIR {
    const opening = node.openingElement;
    const tag = getTagName(opening.name);
    const isComponent = /^[A-Z]/.test(tag);
    const selfClosing = opening.selfClosing;

    const attributes: JSXAttrIR[] = [];
    for (const attr of opening.attributes || []) {
        if (attr.type === 'JSXSpreadAttribute') {
            attributes.push({
                kind: 'spread',
                name: '...',
                value: source.slice(attr.argument.start, attr.argument.end),
            });
            continue;
        }

        // JSXAttribute
        const attrName = getAttrName(attr.name);
        const attrValue = getAttrValue(attr, source);

        if (attr.name.type === 'JSXNamespacedName') {
            const ns = attr.name.namespace.name;
            const local = attr.name.name.name;
            if (ns === 'bind') {
                attributes.push({
                    kind: 'bind',
                    name: `bind:${local}`,
                    bindProperty: local,
                    value: attrValue,
                });
                continue;
            }
        }

        // Event handler: onclick, onkeydown, etc.
        if (attrName.startsWith('on') && attrName.length > 2) {
            attributes.push({
                kind: 'event',
                name: attrName,
                value: attrValue,
            });
            continue;
        }

        // Shorthand: {value} → attribute name=value with expression
        if (attr.value === null && attr.name?.type === 'JSXIdentifier') {
            // Boolean attribute like `disabled`
            attributes.push({
                kind: 'static',
                name: attrName,
                value: 'true',
            });
            continue;
        }

        // Dynamic vs static
        if (attr.value?.type === 'JSXExpressionContainer') {
            attributes.push({
                kind: 'dynamic',
                name: attrName,
                value: attrValue,
            });
        } else {
            attributes.push({
                kind: 'static',
                name: attrName,
                value: attrValue,
            });
        }
    }

    const children = (node.children || []).map((c: any) => analyzeJSXNode(c, source));

    return { type: 'element', tag, isComponent, selfClosing, attributes, children };
}

function getTagName(nameNode: any): string {
    if (nameNode.type === 'JSXIdentifier') return nameNode.name;
    if (nameNode.type === 'JSXMemberExpression') {
        return `${getTagName(nameNode.object)}.${nameNode.property.name}`;
    }
    return 'unknown';
}

function getAttrName(nameNode: any): string {
    if (nameNode.type === 'JSXIdentifier') return nameNode.name;
    if (nameNode.type === 'JSXNamespacedName') {
        return `${nameNode.namespace.name}:${nameNode.name.name}`;
    }
    return 'unknown';
}

function getAttrValue(attr: any, source: string): string | null {
    if (!attr.value) return null;
    if (attr.value.type === 'Literal' || attr.value.type === 'StringLiteral') {
        return attr.value.value;
    }
    if (attr.value.type === 'JSXExpressionContainer') {
        return source.slice(attr.value.expression.start, attr.value.expression.end);
    }
    return source.slice(attr.value.start, attr.value.end);
}

// ── Control flow block analysis ────────────────────────────────────

function unwrapParen(node: any): any {
    while (node?.type === 'ParenthesizedExpression') node = node.expression;
    return node;
}

function extractJSXChildren(node: any, source: string): JSXNodeIR[] {
    const jsx = unwrapParen(node);
    if (!jsx) return [];
    if (jsx.type === 'JSXFragment') {
        return (jsx.children || []).map((c: any) => analyzeJSXNode(c, source));
    }
    const analyzed = analyzeJSXNode(jsx, source);
    return analyzed.type === 'fragment' ? analyzed.children : [analyzed];
}

function analyzeIfBlock(callExpr: any, source: string): JSXIfBlockIR {
    const args = callExpr.arguments;

    // First arg: () => (condition)
    const condArrow = args[0];
    const condBody = unwrapParen(condArrow?.body);
    const condition = condBody ? source.slice(condBody.start, condBody.end) : 'true';

    // Second arg: () => (<>trueBranch</>)
    const trueArrow = args[1];
    const trueBranch = trueArrow ? extractJSXChildren(trueArrow.body, source) : [];

    // Third arg (optional): () => (<>falseBranch</>)
    let falseBranch: JSXNodeIR[] | null = null;
    if (args.length > 2) {
        const falseArrow = args[2];
        falseBranch = falseArrow ? extractJSXChildren(falseArrow.body, source) : null;
    }

    return { type: 'if_block', condition, trueBranch, falseBranch };
}

function analyzeForBlock(callExpr: any, source: string): JSXForBlockIR {
    const args = callExpr.arguments;

    // First arg: () => (collection)
    const collArrow = args[0];
    const collBody = unwrapParen(collArrow?.body);
    const collection = collBody ? source.slice(collBody.start, collBody.end) : '[]';

    // Second arg: (item, index?) => (<>body</>)
    const bodyArrow = args[1];
    const params = bodyArrow?.params || [];
    const itemName = params[0]?.name || 'item';
    const indexName = params.length > 1 ? params[1]?.name : null;
    const body = bodyArrow ? extractJSXChildren(bodyArrow.body, source) : [];

    // Third arg (optional): (item) => (key)
    let keyExpr: string | null = null;
    if (args.length > 2) {
        const keyArrow = args[2];
        const keyBody = unwrapParen(keyArrow?.body);
        keyExpr = keyBody ? source.slice(keyBody.start, keyBody.end) : null;
    }

    return { type: 'for_block', collection, itemName, indexName, keyExpr, body };
}

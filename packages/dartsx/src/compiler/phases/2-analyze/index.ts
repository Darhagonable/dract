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
    /** State vars whose $.state() returns a proxy (object/array init) — skip $.get/$.set */
    proxyVars: Set<string>;
    jsx: JSXNodeIR;
    /** Raw non-JSX statements between state/derived and render (to preserve) */
    bodyStatements: string[];
}

export interface ParamIR {
    name: string;
    /** External prop name if renamed via 'ext-name' as localName syntax */
    externalName: string | null;
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
    | JSXForBlockIR
    | JSXSwitchBlockIR
    | JSXTryBlockIR;

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

export interface JSXSwitchBlockIR {
    type: 'switch_block';
    /** Raw discriminant expression */
    discriminant: string;
    /** Cases with grouped values (null values = default case) */
    cases: { values: string[] | null; body: JSXNodeIR[] }[];
}

export interface JSXTryBlockIR {
    type: 'try_block';
    /** Try branch children */
    tryBranch: JSXNodeIR[];
    /** Catch parameter name (null if no catch) */
    catchParam: string | null;
    /** Catch branch children (null if no catch) */
    catchBranch: JSXNodeIR[] | null;
    /** Pending branch children (null if no pending) */
    pendingBranch: JSXNodeIR[] | null;
}

export interface JSXAttrIR {
    kind: 'static' | 'dynamic' | 'bind' | 'event' | 'shorthand' | 'spread';
    name: string;
    /** For bind: the property being bound (e.g. 'value', 'checked') */
    bindProperty?: string;
    /** Static attribute value string, or raw expression source */
    value: string | null;
    /** For function bindings: explicit getter expression (may be 'null') */
    bindGetter?: string;
    /** For function bindings: explicit setter expression */
    bindSetter?: string;
}

// ── Analysis Result (full module) ──────────────────────────────────

export interface AnalysisResult {
    components: ComponentIR[];
    /** Source text of user import declarations to preserve */
    userImports: string[];
    /** Module-level state variable declarations */
    moduleStateVars: { name: string; initExpr: string; exported: boolean }[];
    /** Module-level derived variable declarations */
    moduleDerivedVars: { name: string; expr: string; exported: boolean }[];
    /** Module-level functions with reactive params */
    moduleFunctions: { signature: string; bodyStatements: string[]; reactiveParams: string[] }[];
    /** Other module-level statements (not imports, not components, not state/derived, not reactive-param functions) */
    moduleStatements: string[];
    /** Module-level reactive var names (state + derived + cross-file imports) */
    moduleReactiveVars: Set<string>;
    /** Module-level proxy vars (object/array state) — skip $.get/$.set */
    moduleProxyVars: Set<string>;
    /** Names of reactive exports (state + derived) for implicit-mode cross-file tracking */
    reactiveExports: string[];
    /**
     * Cross-file reactive function calls detected at call sites.
     * Maps import specifier → { exportedName → reactive param indices }.
     * E.g. { './helper': { test: [0] } } means test() from './helper' is called with a signal at position 0.
     */
    reactiveCalls: Record<string, Record<string, number[]>>;
    /**
     * Maps callable function names to their reactive param indices (for suppressing $.get() on call args).
     * Combines both local functions with reactive params and imported functions with cross-file reactive calls.
     */
    reactiveCallTargets: Map<string, Set<number>>;
    /**
     * Import specifiers found in this module (e.g. ['./helper', './store']).
     * Provided so the Vite plugin can resolve them without regex-parsing the source.
     */
    importSpecifiers: string[];
}

// ── Analyze ────────────────────────────────────────────────────────

export function analyze(
    ast: any,
    source: string,
    meta: PreprocessResult,
    reactiveImports?: Record<string, string[]>,
    reactiveCallImports?: Record<string, number[]>,
): AnalysisResult {
    const components: ComponentIR[] = [];
    const componentNames = new Set(meta.components.map((c) => c.name));
    const stateSet = new Set(meta.stateVars);
    const derivedSet = new Set(meta.derivedVars);

    const userImports: string[] = [];
    const moduleStateVars: { name: string; initExpr: string; exported: boolean }[] = [];
    const moduleDerivedVars: { name: string; expr: string; exported: boolean }[] = [];
    const moduleFunctions: { signature: string; bodyStatements: string[]; reactiveParams: string[] }[] = [];
    const moduleStatements: string[] = [];
    const moduleReactiveVars = new Set<string>();
    const moduleProxyVars = new Set<string>();
    const reactiveExports: string[] = [];
    const pendingFunctions: { node: any; fnInfo: FnInfo }[] = [];
    const pendingStatements: any[] = [];
    /** Maps function names to their ordered param name lists (for call-site analysis) */
    const functionParamMap = new Map<string, string[]>();
    /** Maps imported local names to their source specifier and exported name (for cross-file call tracking) */
    const importSourceMap = new Map<string, { specifier: string; exportedName: string }>();
    /** All import specifiers found in this module */
    const importSpecifiers: string[] = [];

    // Resolve cross-file reactive imports from AST import declarations
    if (reactiveImports) {
        for (const node of ast.body) {
            if (node.type === 'ImportDeclaration' && node.source?.value) {
                const specifier = node.source.value;
                const reactiveNames = reactiveImports[specifier];
                if (!reactiveNames) continue;
                const reactiveSet = new Set(reactiveNames);
                for (const spec of node.specifiers || []) {
                    if (spec.type === 'ImportSpecifier') {
                        const importedName = spec.imported?.name || spec.local?.name;
                        if (reactiveSet.has(importedName)) {
                            moduleReactiveVars.add(spec.local?.name || importedName);
                        }
                    }
                }
            }
        }
    }

    for (const node of ast.body) {
        // Collect user imports (not the runtime import — that's generated)
        if (node.type === 'ImportDeclaration') {
            const src = node.source?.value || '';
            // Skip dartsx internal imports (will be regenerated)
            if (!src.startsWith('dartsx/internal')) {
                userImports.push(source.slice(node.start, node.end));
                if (src) importSpecifiers.push(src);
            }
            // Track import sources for cross-file call detection
            if (src) {
                for (const spec of node.specifiers || []) {
                    if (spec.type === 'ImportSpecifier') {
                        const localName = spec.local?.name || spec.imported?.name;
                        const exportedName = spec.imported?.name || localName;
                        if (localName) {
                            importSourceMap.set(localName, { specifier: src, exportedName });
                        }
                    }
                }
            }
            continue;
        }

        // Check if this is a component function declaration
        const fn = extractFunctionDecl(node);
        if (fn && componentNames.has(fn.name)) {
            const compMeta = meta.components.find((c) => c.name === fn.name)!;
            const ir = analyzeComponent(fn, compMeta, source, stateSet, derivedSet, moduleReactiveVars, meta.renamedParams);
            components.push(ir);
            continue;
        }

        // Module-level variable declarations (state/derived)
        if (node.type === 'VariableDeclaration' || node.type === 'ExportNamedDeclaration') {
            const varDecl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
            const exported = node.type === 'ExportNamedDeclaration';

            if (varDecl?.type === 'VariableDeclaration') {
                let handled = false;
                for (const decl of varDecl.declarations) {
                    const name = decl.id?.name;
                    if (!name) continue;

                    if (stateSet.has(name)) {
                        const initExpr = decl.init ? source.slice(decl.init.start, decl.init.end) : 'undefined';
                        moduleStateVars.push({ name, initExpr, exported });
                        moduleReactiveVars.add(name);
                        if (decl.init && isProxyInit(decl.init)) moduleProxyVars.add(name);
                        if (exported) reactiveExports.push(name);
                        handled = true;
                    } else if (derivedSet.has(name)) {
                        const expr = decl.init ? source.slice(decl.init.start, decl.init.end) : 'undefined';
                        moduleDerivedVars.push({ name, expr, exported });
                        moduleReactiveVars.add(name);
                        if (exported) reactiveExports.push(name);
                        handled = true;
                    }
                }
                if (handled) continue;
            }
        }

        // Check if this is a non-component function — collect for later processing
        const fnInfo = extractFunctionDecl(node);
        if (fnInfo && !componentNames.has(fnInfo.name)) {
            pendingFunctions.push({ node, fnInfo });
            // Collect param names for call-site analysis
            const paramNames = fnInfo.params
                .map((p: any) => p.name || p.argument?.name || p.left?.name)
                .filter(Boolean);
            functionParamMap.set(fnInfo.name, paramNames);
            continue;
        }

        // Everything else — collect for later
        pendingStatements.push(node);
    }

    // Analyze call sites to determine which params receive signals
    const implicitReactiveParams = new Map<string, Set<string>>();
    const importedReactiveCalls: Record<string, Record<string, Set<number>>> = {};
    // Build a comprehensive set of ALL reactive vars (module + component-level)
    const allReactiveVars = new Set([...moduleReactiveVars, ...stateSet, ...derivedSet]);
    // Walk the entire AST looking for call expressions
    walkCallSites(ast, allReactiveVars, functionParamMap, implicitReactiveParams, importSourceMap, importedReactiveCalls);

    // Now process pending functions
    for (const { node, fnInfo } of pendingFunctions) {
        let reactiveParams: string[] | undefined;

        if (implicitReactiveParams.has(fnInfo.name)) {
            // Params detected at same-file call sites
            reactiveParams = [...implicitReactiveParams.get(fnInfo.name)!];
        } else if (reactiveCallImports?.[fnInfo.name]) {
            // Params detected at cross-file call sites (via Vite plugin)
            const indices = reactiveCallImports[fnInfo.name];
            const paramNames = functionParamMap.get(fnInfo.name) || [];
            reactiveParams = indices
                .filter((i) => i < paramNames.length)
                .map((i) => paramNames[i]);
        }

        if (reactiveParams && reactiveParams.length > 0) {
            const signature = source.slice(node.start, fnInfo.body.start + 1);
            const bodyStmts: string[] = [];
            const stmts = fnInfo.body.statements || fnInfo.body.body || [];
            for (const s of stmts) {
                bodyStmts.push(source.slice(s.start, s.end));
            }
            moduleFunctions.push({ signature, bodyStatements: bodyStmts, reactiveParams });
        } else {
            // No reactive params — preserve as-is
            moduleStatements.push(source.slice(node.start, node.end));
        }
    }

    // Process pending non-function statements
    for (const node of pendingStatements) {
        moduleStatements.push(source.slice(node.start, node.end));
    }

    // Convert Set<number> to number[] for the result
    const reactiveCalls: Record<string, Record<string, number[]>> = {};
    for (const [specifier, fns] of Object.entries(importedReactiveCalls)) {
        reactiveCalls[specifier] = {};
        for (const [fnName, indices] of Object.entries(fns)) {
            reactiveCalls[specifier][fnName] = [...indices];
        }
    }

    // Build reactiveCallTargets: which functions should NOT have their args unwrapped
    const reactiveCallTargets = new Map<string, Set<number>>();
    // Local functions with reactive params: map param names to indices
    for (const fn of moduleFunctions) {
        const paramNames = functionParamMap.get(fn.signature.match(/function\s+(\w+)/)?.[1] || '') || [];
        const indices = new Set<number>();
        for (const rp of fn.reactiveParams) {
            const idx = paramNames.indexOf(rp);
            if (idx >= 0) indices.add(idx);
        }
        const fnName = fn.signature.match(/function\s+(\w+)/)?.[1];
        if (fnName && indices.size > 0) {
            reactiveCallTargets.set(fnName, indices);
        }
    }
    // Imported functions with detected reactive call positions (from same-file call-site analysis)
    for (const [_specifier, fns] of Object.entries(reactiveCalls)) {
        for (const [fnName, indices] of Object.entries(fns)) {
            // Find the local name for this imported function
            for (const [localName, info] of importSourceMap) {
                if (info.exportedName === fnName) {
                    const existing = reactiveCallTargets.get(localName) || new Set();
                    for (const idx of indices) existing.add(idx);
                    reactiveCallTargets.set(localName, existing);
                }
            }
        }
    }
    // Imported functions with reactive param info from cross-file tracking (via Vite plugin)
    if (reactiveCallImports) {
        for (const [fnName, indices] of Object.entries(reactiveCallImports)) {
            const existing = reactiveCallTargets.get(fnName) || new Set();
            for (const idx of indices) existing.add(idx);
            reactiveCallTargets.set(fnName, existing);
        }
    }

    return {
        components,
        userImports,
        moduleStateVars,
        moduleDerivedVars,
        moduleFunctions,
        moduleStatements,
        moduleReactiveVars,
        moduleProxyVars,
        reactiveExports,
        reactiveCalls,
        reactiveCallTargets,
        importSpecifiers,
    };
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Walk the AST looking for call expressions like `test(reactiveVar, normalVar)`.
 * When a call targets a known local function and passes a reactive variable as an argument,
 * mark that positional parameter as reactive.
 * Also detects calls to imported functions and records which positions receive reactive args.
 */
function walkCallSites(
    ast: any,
    reactiveVars: Set<string>,
    functionParamMap: Map<string, string[]>,
    localResult: Map<string, Set<string>>,
    importSourceMap: Map<string, { specifier: string; exportedName: string }>,
    importedResult: Record<string, Record<string, Set<number>>>,
) {
    function visit(node: any) {
        if (!node || typeof node !== 'object') return;

        if (node.type === 'CallExpression' && node.callee?.type === 'Identifier') {
            const fnName = node.callee.name;
            const args: any[] = node.arguments || [];

            // Check calls to local functions
            const paramNames = functionParamMap.get(fnName);
            if (paramNames) {
                for (let i = 0; i < args.length && i < paramNames.length; i++) {
                    const arg = args[i];
                    if (arg.type === 'Identifier' && reactiveVars.has(arg.name)) {
                        if (!localResult.has(fnName)) localResult.set(fnName, new Set());
                        localResult.get(fnName)!.add(paramNames[i]);
                    }
                }
            }

            // Check calls to imported functions
            const importInfo = importSourceMap.get(fnName);
            if (importInfo) {
                for (let i = 0; i < args.length; i++) {
                    const arg = args[i];
                    if (arg.type === 'Identifier' && reactiveVars.has(arg.name)) {
                        if (!importedResult[importInfo.specifier]) importedResult[importInfo.specifier] = {};
                        if (!importedResult[importInfo.specifier][importInfo.exportedName]) {
                            importedResult[importInfo.specifier][importInfo.exportedName] = new Set();
                        }
                        importedResult[importInfo.specifier][importInfo.exportedName].add(i);
                    }
                }
            }
        }

        // Recurse into known AST child fields (avoids Object.keys() on every node)
        for (const key of AST_CHILD_FIELDS) {
            const child = node[key];
            if (child == null) continue;
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (item && typeof item === 'object' && item.type) visit(item);
                }
            } else if (typeof child === 'object' && child.type) {
                visit(child);
            }
        }
    }

    visit(ast);
}

/** Known AST fields that contain child nodes — avoids iterating all object keys */
const AST_CHILD_FIELDS = [
    'body', 'declarations', 'declaration', 'init', 'test', 'consequent',
    'alternate', 'expression', 'expressions', 'left', 'right', 'object',
    'property', 'callee', 'arguments', 'elements', 'properties', 'value',
    'argument', 'params', 'items', 'statements', 'block', 'handler',
    'finalizer', 'cases', 'discriminant', 'update', 'children',
    'openingElement', 'closingElement', 'attributes', 'specifiers',
    'source', 'key', 'id', 'label', 'tag', 'quasi', 'quasis',
];

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
    crossFileReactiveVars: Set<string>,
    renamedParams: Record<string, string>,
): ComponentIR {
    const params: ParamIR[] = [];
    const stateVars: { name: string; initExpr: string }[] = [];
    const derivedVars: { name: string; expr: string }[] = [];
    const reactiveVars = new Set<string>(crossFileReactiveVars);
    const proxyVars = new Set<string>();
    const bodyStatements: string[] = [];
    let jsx: JSXNodeIR | null = null;

    // Analyze params
    for (const param of fn.params) {
        const p = analyzeParam(param, source, renamedParams);
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
                        if (decl.init && isProxyInit(decl.init)) proxyVars.add(name);
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

    return { meta: compMeta, params, stateVars, derivedVars, reactiveVars, proxyVars, jsx, bodyStatements };
}

function analyzeParam(param: any, source: string, renamedParams: Record<string, string>): ParamIR {
    if (param.type === 'RestElement') {
        return {
            name: param.argument?.name || 'rest',
            externalName: null,
            isBind: false,
            isRest: true,
            defaultValue: null,
        };
    }
    if (param.type === 'AssignmentPattern') {
        const rawName = param.left?.name || 'unknown';
        const isBind = rawName.startsWith('__bind__');
        const name = isBind ? rawName.slice(8) : rawName;
        return {
            name,
            externalName: renamedParams[name] || null,
            isBind,
            isRest: false,
            defaultValue: source.slice(param.right.start, param.right.end),
        };
    }
    if (param.type === 'Identifier') {
        const rawName = param.name;
        const isBind = rawName.startsWith('__bind__');
        const name = isBind ? rawName.slice(8) : rawName;
        return {
            name,
            externalName: renamedParams[name] || null,
            isBind,
            isRest: false,
            defaultValue: null,
        };
    }
    // Fallback
    return { name: 'unknown', externalName: null, isBind: false, isRest: false, defaultValue: null };
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
            // Detect __switch() calls
            if (
                expr.type === 'CallExpression' &&
                expr.callee?.type === 'Identifier' &&
                expr.callee.name === '__switch'
            ) {
                return analyzeSwitchBlock(expr, source);
            }
            // Detect __try() calls
            if (
                expr.type === 'CallExpression' &&
                expr.callee?.type === 'Identifier' &&
                expr.callee.name === '__try'
            ) {
                return analyzeTryBlock(expr, source);
            }
            // Detect .map() calls returning JSX: expr.map(item => <jsx/>)
            if (
                expr.type === 'CallExpression' &&
                expr.callee?.type === 'MemberExpression' &&
                expr.callee.property?.name === 'map'
            ) {
                const callback = expr.arguments?.[0];
                if (
                    callback &&
                    (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') &&
                    isJSXNode(callback.body)
                ) {
                    return analyzeMapExpression(expr, source);
                }
            }
            // Detect ternary: condition ? <JSX/> : <JSX/>
            if (expr.type === 'ConditionalExpression') {
                const consqIsJSX = isJSXNode(expr.consequent);
                const altIsJSX = isJSXNode(expr.alternate);
                const altIsNullish = isNullishNode(expr.alternate);
                if (consqIsJSX && (altIsJSX || altIsNullish)) {
                    return analyzeTernaryExpression(expr, source);
                }
            }
            // Detect logical &&: condition && <JSX/>
            if (expr.type === 'LogicalExpression' && expr.operator === '&&') {
                if (isJSXNode(expr.right)) {
                    return analyzeLogicalAndExpression(expr, source);
                }
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
                const expr = attr.value?.type === 'JSXExpressionContainer' ? attr.value.expression : null;
                if (expr?.type === 'ArrayExpression' && expr.elements.length === 2) {
                    // Function binding: bind:value={getter, setter} (pre-wrapped as array by parser)
                    const getExpr = source.slice(expr.elements[0].start, expr.elements[0].end);
                    const setExpr = source.slice(expr.elements[1].start, expr.elements[1].end);
                    attributes.push({
                        kind: 'bind',
                        name: `bind:${local}`,
                        bindProperty: local,
                        value: null,
                        bindGetter: getExpr,
                        bindSetter: setExpr,
                    });
                } else {
                    attributes.push({
                        kind: 'bind',
                        name: `bind:${local}`,
                        bindProperty: local,
                        value: attrValue,
                    });
                }
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

/**
 * Detect whether a state initializer will produce a proxy at runtime.
 * $.state() returns a proxy for objects/arrays, a Signal for primitives.
 */
function isProxyInit(initNode: any): boolean {
    if (!initNode) return false;
    const t = initNode.type;
    return t === 'ObjectExpression' || t === 'ArrayExpression' ||
        (t === 'NewExpression' && initNode.callee?.type === 'Identifier' &&
            ['Map', 'Set', 'WeakMap', 'WeakSet'].includes(initNode.callee.name));
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
    const itemParam = params[0];
    const itemName = itemParam?.name || (itemParam ? source.slice(itemParam.start, itemParam.end) : 'item');
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

function analyzeSwitchBlock(callExpr: any, source: string): JSXSwitchBlockIR {
    const args = callExpr.arguments;

    // First arg: () => (discriminant)
    const discArrow = args[0];
    const discBody = unwrapParen(discArrow?.body);
    const discriminant = discBody ? source.slice(discBody.start, discBody.end) : '""';

    // Remaining args come in pairs: (values-array-or-null, body-fn)
    const cases: { values: string[] | null; body: JSXNodeIR[] }[] = [];
    for (let i = 1; i < args.length; i += 2) {
        const valuesArg = args[i];
        const fnArg = args[i + 1];

        let values: string[] | null = null;
        if (valuesArg.type === 'ArrayExpression') {
            values = (valuesArg.elements || []).map((el: any) =>
                source.slice(el.start, el.end),
            );
        }
        // NullLiteral → values stays null (default case)

        const body = fnArg ? extractJSXChildren(fnArg.body, source) : [];
        cases.push({ values, body });
    }

    return { type: 'switch_block', discriminant, cases };
}

function analyzeTryBlock(callExpr: any, source: string): JSXTryBlockIR {
    const args = callExpr.arguments;

    // First arg: () => (<>tryBody</>)
    const tryArrow = args[0];
    const tryBranch = tryArrow ? extractJSXChildren(tryArrow.body, source) : [];

    // Second arg (optional): (param) => (<>catchBody</>) or null
    let catchParam: string | null = null;
    let catchBranch: JSXNodeIR[] | null = null;
    if (args.length > 1 && args[1].type !== 'NullLiteral') {
        const catchArrow = args[1];
        catchParam = catchArrow.params?.[0]?.name || 'e';
        catchBranch = extractJSXChildren(catchArrow.body, source);
    }

    // Third arg (optional): () => (<>pendingBody</>)
    let pendingBranch: JSXNodeIR[] | null = null;
    if (args.length > 2) {
        const pendArrow = args[2];
        pendingBranch = extractJSXChildren(pendArrow.body, source);
    }

    return { type: 'try_block', tryBranch, catchParam, catchBranch, pendingBranch };
}

// ── JSX expression pattern detection helpers ───────────────────────

function isJSXNode(node: any): boolean {
    const unwrapped = unwrapParen(node);
    return unwrapped?.type === 'JSXElement' || unwrapped?.type === 'JSXFragment';
}

function isNullishNode(node: any): boolean {
    const unwrapped = unwrapParen(node);
    if (!unwrapped) return false;
    if (unwrapped.type === 'NullLiteral') return true;
    if (unwrapped.type === 'Literal' && unwrapped.value === null) return true;
    if (unwrapped.type === 'Identifier' && unwrapped.name === 'undefined') return true;
    return false;
}

function analyzeMapExpression(callExpr: any, source: string): JSXForBlockIR {
    const collection = source.slice(callExpr.callee.object.start, callExpr.callee.object.end);
    const callback = callExpr.arguments[0];
    const params = callback.params || [];
    const itemParam = params[0];
    const itemName = itemParam?.name || (itemParam ? source.slice(itemParam.start, itemParam.end) : 'item');
    const indexName = params.length > 1 ? (params[1]?.name || null) : null;
    const body = extractJSXChildren(callback.body, source);
    return { type: 'for_block', collection, itemName, indexName, keyExpr: null, body };
}

function analyzeTernaryExpression(expr: any, source: string): JSXIfBlockIR {
    const condition = source.slice(expr.test.start, expr.test.end);
    const trueBranch = extractJSXChildren(expr.consequent, source);
    let falseBranch: JSXNodeIR[] | null = null;
    if (!isNullishNode(expr.alternate)) {
        falseBranch = extractJSXChildren(expr.alternate, source);
    }
    return { type: 'if_block', condition, trueBranch, falseBranch };
}

function analyzeLogicalAndExpression(expr: any, source: string): JSXIfBlockIR {
    const condition = source.slice(expr.left.start, expr.left.end);
    const trueBranch = extractJSXChildren(expr.right, source);
    return { type: 'if_block', condition, trueBranch, falseBranch: null };
}

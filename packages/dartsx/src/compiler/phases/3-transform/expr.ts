/**
 * AST-based expression transformer.
 *
 * Uses OXC to parse expressions into an AST, then walks the tree to produce
 * span-based text replacements — no regex guessing.
 */
import { parseSync } from 'oxc-parser';
import type {
    Expression,
    AssignmentExpression,
    UpdateExpression,
    IdentifierReference,
    ParenthesizedExpression,
} from 'oxc-parser';

// ── Helpers ────────────────────────────────────────────────────────

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
 * Uses OXC AST to precisely identify `IdentifierReference` nodes.
 */
export function wrapReadsInGet(expr: string, reactiveVars: Set<string>, proxyVars?: Set<string>): string {
    const ast = parseExpression(expr);
    if (!ast) return expr; // fallback: return unchanged

    const replacements: Replacement[] = [];

    walk(ast as ASTNode, (node, parent, key) => {
        if (node.type === 'Identifier' && reactiveVars.has(node.name)) {
            // Skip proxy vars — proxy traps handle reactivity directly
            if (proxyVars?.has(node.name)) return;
            // Skip if this is the property of a non-computed member expression (obj.count)
            if (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) {
                return;
            }
            const id = node as unknown as IdentifierReference;
            // Offset from wrapper
            const start = id.start - WRAPPER_OFFSET;
            const end = id.end - WRAPPER_OFFSET;
            replacements.push({ start, end, text: `$.get(${id.name})` });
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
export function transformEventHandler(raw: string, reactiveVars: Set<string>, proxyVars?: Set<string>): string {
    const trimmed = raw.trim();
    const ast = parseExpression(trimmed);
    if (!ast) return `() => ${wrapReadsInGet(trimmed, reactiveVars, proxyVars)}`;

    // Arrow function: transform the body
    if (ast.type === 'ArrowFunctionExpression') {
        const arrow = ast as any;
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
                ? transformExpr(bodySource, bodyAST as ASTNode, reactiveVars, proxyVars)
                : wrapReadsInGet(bodySource, reactiveVars, proxyVars);
            return `${prefix} ${transformedBody}`;
        }
        // Block body — just wrap reads
        return wrapReadsInGet(trimmed, reactiveVars, proxyVars);
    }

    // Bare identifier (function reference) — just wrap if reactive
    if (ast.type === 'Identifier') {
        return wrapReadsInGet(trimmed, reactiveVars, proxyVars);
    }

    // Update or assignment — wrap in arrow
    const transformed = transformExpr(trimmed, ast, reactiveVars, proxyVars);
    if (transformed !== trimmed) {
        return `() => ${transformed}`;
    }

    // Fallback: wrap reads and put in arrow
    return `() => ${wrapReadsInGet(trimmed, reactiveVars, proxyVars)}`;
}

/**
 * Transform a single expression node, handling assignments and updates.
 */
function transformExpr(source: string, node: ASTNode, reactiveVars: Set<string>, proxyVars?: Set<string>): string {
    // UpdateExpression: count++ / count-- / ++count / --count
    if (node.type === 'UpdateExpression') {
        const update = node as unknown as UpdateExpression;
        const arg = update.argument;
        if (arg.type === 'Identifier' && reactiveVars.has((arg as any).name) && !proxyVars?.has((arg as any).name)) {
            const name = (arg as any).name;
            const delta = update.operator === '++' ? '+ 1' : '- 1';
            return `$.set(${name}, $.get(${name}) ${delta})`;
        }
    }

    // AssignmentExpression: count = x / count += x / etc.
    if (node.type === 'AssignmentExpression') {
        const assign = node as unknown as AssignmentExpression;
        const left = assign.left;
        if (left.type === 'Identifier' && reactiveVars.has((left as any).name) && !proxyVars?.has((left as any).name)) {
            const name = (left as any).name;
            const rhsStart = assign.right.start - WRAPPER_OFFSET;
            const rhsEnd = assign.right.end - WRAPPER_OFFSET;
            const rhsSource = source.slice(rhsStart, rhsEnd);
            const transformedRhs = wrapReadsInGet(rhsSource, reactiveVars, proxyVars);

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
        const seq = node as any;
        const parts = seq.expressions.map((expr: ASTNode) => {
            const s = expr.start - WRAPPER_OFFSET;
            const e = expr.end - WRAPPER_OFFSET;
            const subSource = source.slice(s, e);
            // Re-parse each sub-expression for correct span offsets
            const subAST = parseExpression(subSource);
            return subAST
                ? transformExpr(subSource, subAST as ASTNode, reactiveVars, proxyVars)
                : wrapReadsInGet(subSource, reactiveVars, proxyVars);
        });
        return parts.join(', ');
    }

    // Default: just wrap reads
    return wrapReadsInGet(source, reactiveVars, proxyVars);
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
): string {
    if (reactiveVars.size === 0) return stmt;

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
            if (root && reactiveVars.has(root)) {
                const exprText = stmt.slice(s(arg.start), s(arg.end));
                replacements.push({ start: s(arg.start), end: s(arg.end), text: `$.derived(() => ${exprText})` });
            }
        }
    }

    // Collect exclusion zones: first argument of effect() calls
    // (deps must remain as Signal objects, not unwrapped via $.get())
    // and args at reactive positions for functions with reactive params.
    // For any exclusion-zone arg that is a member expression on a reactive root,
    // wrap it in $.derived(() => ...) so the callee receives a Derived signal.
    const exclusionZones: { start: number; end: number }[] = [];

    function addExclusionArg(arg: ASTNode): void {
        exclusionZones.push({ start: arg.start, end: arg.end });
        // Array literal of deps: wrap each element individually
        if (arg.type === 'ArrayExpression' && arg.elements) {
            for (const elem of arg.elements) {
                if (elem) wrapDepIfNeeded(elem);
            }
        } else {
            wrapDepIfNeeded(arg);
        }
    }

    walk(result.program as ASTNode, (node) => {
        if (
            node.type === 'CallExpression' &&
            node.callee?.type === 'Identifier' &&
            node.callee.name === 'effect' &&
            node.arguments?.length >= 2
        ) {
            addExclusionArg(node.arguments[0]);
        }
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

    // Pass 1: Assignments and updates to reactive vars
    walk(result.program as ASTNode, (node, parent, key) => {
        if (node.type === 'AssignmentExpression') {
            const left = node.left;
            if (left?.type === 'Identifier' && reactiveVars.has(left.name) && !proxyVars?.has(left.name)) {
                const name = left.name;
                const rhsSource = stmt.slice(s(node.right.start), s(node.right.end));
                const wrappedRhs = wrapReadsInGet(rhsSource, reactiveVars, proxyVars);

                const text = node.operator === '='
                    ? `$.set(${name}, ${wrappedRhs})`
                    : `$.set(${name}, $.get(${name}) ${node.operator.slice(0, -1)} ${wrappedRhs})`;

                replacements.push({ start: s(node.start), end: s(node.end), text });
                coveredSpans.push({ start: node.start, end: node.end });
            }
        }

        if (node.type === 'UpdateExpression') {
            const arg = node.argument;
            if (arg?.type === 'Identifier' && reactiveVars.has(arg.name) && !proxyVars?.has(arg.name)) {
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
    walk(result.program as ASTNode, (node, parent, key) => {
        if (node.type !== 'Identifier' || !reactiveVars.has(node.name)) return;
        // Skip proxy vars — proxy traps handle reactivity directly
        if (proxyVars?.has(node.name)) return;
        // Skip assignment LHS
        if (parent?.type === 'AssignmentExpression' && key === 'left') return;
        // Skip update argument
        if (parent?.type === 'UpdateExpression') return;
        // Skip non-computed member property (obj.x)
        if (parent?.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
        // Skip function param declarations (BindingIdentifier)
        if (parent?.type === 'FormalParameter' || parent?.type === 'FormalParameters') return;

        const start = node.start;
        const end = node.end;
        // Skip if inside a span already covered by Pass 1
        if (coveredSpans.some((c) => start >= c.start && end <= c.end)) return;
        // Skip if inside an exclusion zone (effect dep argument or reactive call arg)
        if (exclusionZones.some((z) => start >= z.start && end <= z.end)) return;

        replacements.push({ start: s(start), end: s(end), text: `$.get(${node.name})` });
    });

    return replacements.length > 0 ? applyReplacements(stmt, replacements) : stmt;
}

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
export function wrapReadsInGet(expr: string, reactiveVars: Set<string>): string {
    const ast = parseExpression(expr);
    if (!ast) return expr; // fallback: return unchanged

    const replacements: Replacement[] = [];

    walk(ast as ASTNode, (node, parent, key) => {
        if (node.type === 'Identifier' && reactiveVars.has(node.name)) {
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
export function transformEventHandler(raw: string, reactiveVars: Set<string>): string {
    const trimmed = raw.trim();
    const ast = parseExpression(trimmed);
    if (!ast) return `() => ${wrapReadsInGet(trimmed, reactiveVars)}`;

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
            const transformedBody = transformExpr(bodySource, arrow.body, reactiveVars);
            return `${prefix} ${transformedBody}`;
        }
        // Block body — just wrap reads
        return wrapReadsInGet(trimmed, reactiveVars);
    }

    // Bare identifier (function reference) — just wrap if reactive
    if (ast.type === 'Identifier') {
        return wrapReadsInGet(trimmed, reactiveVars);
    }

    // Update or assignment — wrap in arrow
    const transformed = transformExpr(trimmed, ast, reactiveVars);
    if (transformed !== trimmed) {
        return `() => ${transformed}`;
    }

    // Fallback: wrap reads and put in arrow
    return `() => ${wrapReadsInGet(trimmed, reactiveVars)}`;
}

/**
 * Transform a single expression node, handling assignments and updates.
 */
function transformExpr(source: string, node: ASTNode, reactiveVars: Set<string>): string {
    // UpdateExpression: count++ / count-- / ++count / --count
    if (node.type === 'UpdateExpression') {
        const update = node as unknown as UpdateExpression;
        const arg = update.argument;
        if (arg.type === 'Identifier' && reactiveVars.has((arg as any).name)) {
            const name = (arg as any).name;
            const delta = update.operator === '++' ? '+ 1' : '- 1';
            return `$.set(${name}, $.get(${name}) ${delta})`;
        }
    }

    // AssignmentExpression: count = x / count += x / etc.
    if (node.type === 'AssignmentExpression') {
        const assign = node as unknown as AssignmentExpression;
        const left = assign.left;
        if (left.type === 'Identifier' && reactiveVars.has((left as any).name)) {
            const name = (left as any).name;
            const rhsStart = assign.right.start - WRAPPER_OFFSET;
            const rhsEnd = assign.right.end - WRAPPER_OFFSET;
            const rhsSource = source.slice(rhsStart, rhsEnd);
            const transformedRhs = wrapReadsInGet(rhsSource, reactiveVars);

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
            return transformExpr(source.slice(s, e), expr, reactiveVars);
        });
        return parts.join(', ');
    }

    // Default: just wrap reads
    return wrapReadsInGet(source, reactiveVars);
}

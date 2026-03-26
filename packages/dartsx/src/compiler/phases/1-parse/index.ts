/**
 * Phase 1 — Parse
 *
 * Pre-processes DarTsx custom syntax into valid TSX that OXC can parse,
 * then parses with OXC. Returns the AST plus metadata about which
 * identifiers are state/derived/components.
 */
import { parseSync } from 'oxc-parser';

// ── Types ──────────────────────────────────────────────────────────

export interface ComponentMeta {
    name: string;
    isExport: boolean;
    isDefault: boolean;
    isAsync: boolean;
}

export interface PreprocessResult {
    /** The transformed source that OXC can parse */
    code: string;
    /** Components found during pre-processing */
    components: ComponentMeta[];
    /** Names of `state` variable declarations */
    stateVars: string[];
    /** Names of `derived` variable declarations */
    derivedVars: string[];
    /** State imports: `import { state x } from '...'` */
    stateImports: string[];
}

// ── Pre-process ────────────────────────────────────────────────────

export function preprocess(source: string): PreprocessResult {
    let code = source;
    const components: ComponentMeta[] = [];
    const stateVars: string[] = [];
    const derivedVars: string[] = [];
    const stateImports: string[] = [];

    // 1. Transform `import { state x } from '...'` to `import { x } from '...'`
    //    and record x as a state import
    code = code.replace(
        /\bimport\s*\{([^}]*)\}\s*from/g,
        (_match, specifiers: string) => {
            const transformed = specifiers.replace(
                /\bstate\s+(\w+)/g,
                (_m: string, name: string) => {
                    stateImports.push(name);
                    return name;
                },
            );
            return `import {${transformed}} from`;
        },
    );

    // 2. Transform component declarations
    //    Handles: [export] [default] [async] component Name(...)
    code = code.replace(
        /\b(export\s+)?(default\s+)?(async\s+)?component\s+(\w+)/g,
        (_match, exportKw, defaultKw, asyncKw, name) => {
            components.push({
                name,
                isExport: !!exportKw,
                isDefault: !!defaultKw,
                isAsync: !!asyncKw,
            });
            return `${exportKw || ''}${defaultKw || ''}${asyncKw || ''}function ${name}`;
        },
    );

    // 3. Transform `state varName = expr` → `let varName = expr`
    //    Only match when `state` is used as a declaration keyword (not property access)
    code = code.replace(
        /(?<!\.)(?<!\w)\bstate\s+(\w+)\s*(?==)/g,
        (_match, name) => {
            stateVars.push(name);
            return `let ${name} `;
        },
    );

    // 4. Transform `derived varName = expr` → `let varName = expr`
    code = code.replace(
        /(?<!\.)(?<!\w)\bderived\s+(\w+)\s*(?==)/g,
        (_match, name) => {
            derivedVars.push(name);
            return `let ${name} `;
        },
    );

    // 5. Transform `render (` blocks → `return (<>` ... `</>)`
    code = transformRenderBlocks(code);

    // 6. Transform `bind:{x}` shorthand → `bind:value={x}`
    code = code.replace(/bind:\{(\w+)\}/g, 'bind:value={$1}');

    return { code, components, stateVars, derivedVars, stateImports };
}

// ── Render block transformation ────────────────────────────────────

function transformRenderBlocks(code: string): string {
    const renderRegex = /\brender\s*\(/g;
    let match;
    let result = '';
    let lastIndex = 0;

    while ((match = renderRegex.exec(code)) !== null) {
        const renderStart = match.index;
        const openParenPos = renderStart + match[0].length - 1;
        const closeParenPos = findMatchingParen(code, openParenPos);

        const content = code.slice(openParenPos + 1, closeParenPos);

        result += code.slice(lastIndex, renderStart);
        result += `return (<>${content}</>)`;
        lastIndex = closeParenPos + 1;
    }

    result += code.slice(lastIndex);
    return result;
}

// ── Helper: find matching parenthesis ──────────────────────────────

function findMatchingParen(code: string, openPos: number): number {
    let depth = 1;
    let i = openPos + 1;
    while (i < code.length && depth > 0) {
        const ch = code[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === "'" || ch === '"') {
            i = skipString(code, i);
            continue;
        } else if (ch === '`') {
            i = skipTemplateLiteral(code, i);
            continue;
        }
        i++;
    }
    return i - 1;
}

function skipString(code: string, start: number): number {
    const quote = code[start];
    let i = start + 1;
    while (i < code.length) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === quote) return i + 1;
        i++;
    }
    return i;
}

function skipTemplateLiteral(code: string, start: number): number {
    let i = start + 1;
    while (i < code.length) {
        if (code[i] === '\\') { i += 2; continue; }
        if (code[i] === '`') return i + 1;
        if (code[i] === '$' && code[i + 1] === '{') {
            i += 2;
            let depth = 1;
            while (i < code.length && depth > 0) {
                if (code[i] === '{') depth++;
                else if (code[i] === '}') depth--;
                i++;
            }
            continue;
        }
        i++;
    }
    return i;
}

// ── Parse with OXC ─────────────────────────────────────────────────

export function parse(filename: string, code: string) {
    return parseSync(filename, code, { sourceType: 'module', lang: 'tsx' });
}

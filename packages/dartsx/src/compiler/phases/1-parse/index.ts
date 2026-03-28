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

    // 7. Transform control flow blocks ({if}, {for}) into parseable __if()/__for() calls
    code = transformControlFlowBlocks(code);

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

// ── Control flow block transformation ──────────────────────────────

interface ControlFlowResult {
    text: string;
    end: number;
}

function transformControlFlowBlocks(code: string): string {
    let result = '';
    let i = 0;

    while (i < code.length) {
        // Skip strings
        if (code[i] === "'" || code[i] === '"') {
            const end = skipString(code, i);
            result += code.slice(i, end);
            i = end;
            continue;
        }
        if (code[i] === '`') {
            const end = skipTemplateLiteral(code, i);
            result += code.slice(i, end);
            i = end;
            continue;
        }

        if (code[i] === '{') {
            let j = i + 1;
            while (j < code.length && /\s/.test(code[j])) j++;

            if (/^if\s*\(/.test(code.slice(j))) {
                const parsed = tryParseIfBlock(code, i);
                if (parsed) {
                    result += parsed.text;
                    i = parsed.end;
                    continue;
                }
            }

            if (/^for\s*\(/.test(code.slice(j))) {
                const parsed = tryParseForBlock(code, i);
                if (parsed) {
                    result += parsed.text;
                    i = parsed.end;
                    continue;
                }
            }
        }

        result += code[i];
        i++;
    }

    return result;
}

function tryParseIfBlock(code: string, outerBrace: number): ControlFlowResult | null {
    // Find the matching brace of the JSX expression container {if (...) {...}}
    const outerClose = findMatchingBrace(code, outerBrace);
    const content = code.slice(outerBrace + 1, outerClose).trim();

    if (!content.startsWith('if')) return null;

    // Recursively transform nested control flow blocks first,
    // so the content becomes valid TSX that OXC can parse.
    const transformed = transformControlFlowBlocks(content);

    // Parse the transformed if statement with OXC
    const result = parseSync('if-block.tsx', transformed, {
        sourceType: 'script',
        lang: 'tsx',
    });
    if (result.errors.length > 0) return null;

    const stmts = result.program.body;
    if (stmts.length === 0 || stmts[0].type !== 'IfStatement') return null;

    const output = buildIfCall(transformed, stmts[0] as any);
    return { text: `{${output}}`, end: outerClose + 1 };
}

/**
 * Recursively build __if() calls from an OXC IfStatement AST node.
 * Handles else-if chains naturally through AST recursion.
 */
function buildIfCall(source: string, stmt: any): string {
    const condition = source.slice(stmt.test.start, stmt.test.end);
    const trueBody = source.slice(stmt.consequent.start + 1, stmt.consequent.end - 1).trim();

    if (stmt.alternate) {
        if (stmt.alternate.type === 'IfStatement') {
            // else if — recurse to build nested __if
            const nestedCall = buildIfCall(source, stmt.alternate);
            return `__if(() => (${condition}), () => (<>${trueBody}</>), () => (<>${nestedCall}</>))`;
        }
        // else block
        const falseBody = source.slice(stmt.alternate.start + 1, stmt.alternate.end - 1).trim();
        return `__if(() => (${condition}), () => (<>${trueBody}</>), () => (<>${falseBody}</>))`;
    }

    return `__if(() => (${condition}), () => (<>${trueBody}</>))`;
}

function tryParseForBlock(code: string, outerBrace: number): ControlFlowResult | null {
    const outerClose = findMatchingBrace(code, outerBrace);
    const content = code.slice(outerBrace + 1, outerClose).trim();

    if (!content.startsWith('for')) return null;

    // Find the header parentheses: for (...)
    const parenStart = content.indexOf('(');
    if (parenStart === -1) return null;
    const parenEnd = findMatchingParen(content, parenStart);
    const fullHeader = content.slice(parenStart + 1, parenEnd).trim();

    // Split on ';' to separate DarTsx extensions (index, key)
    const parts = fullHeader.split(';').map((s) => s.trim());
    const mainPart = parts[0];

    let indexName: string | null = null;
    let keyExpr: string | null = null;
    for (let k = 1; k < parts.length; k++) {
        const part = parts[k];
        if (part.startsWith('index ')) indexName = part.slice(6).trim();
        else if (part.startsWith('key ')) keyExpr = part.slice(4).trim();
    }

    // Use OXC to parse the standard for-of part (handles destructuring patterns)
    const forSource = `for (${mainPart}) {}`;
    const result = parseSync('for-block.tsx', forSource, {
        sourceType: 'script',
        lang: 'tsx',
    });
    if (result.errors.length > 0 || result.program.body.length === 0) return null;

    const forStmt = result.program.body[0] as any;
    if (forStmt.type !== 'ForOfStatement') return null;

    // Extract variable pattern and collection from the OXC AST
    const leftSource = forSource.slice(forStmt.left.start, forStmt.left.end);
    const collection = forSource.slice(forStmt.right.start, forStmt.right.end);

    // Strip const/let/var to get the callback parameter pattern
    const paramPattern = leftSource.replace(/^(?:const|let|var)\s+/, '');

    // Extract body (everything after the header parens)
    const bodyText = content.slice(parenEnd + 1).trim();
    if (!bodyText.startsWith('{') || !bodyText.endsWith('}')) return null;
    const body = bodyText.slice(1, -1).trim();

    // Recursively transform nested control flow
    const transformedBody = transformControlFlowBlocks(body);

    // Build the __for call
    const params = indexName ? `${paramPattern}, ${indexName}` : paramPattern;
    let text: string;
    if (keyExpr) {
        text = `{__for(() => (${collection}), (${params}) => (<>${transformedBody}</>), (${paramPattern}) => (${keyExpr}))}`;
    } else {
        text = `{__for(() => (${collection}), (${params}) => (<>${transformedBody}</>))}`;
    }

    return { text, end: outerClose + 1 };
}

// ── Helper: find matching brace ────────────────────────────────────

function findMatchingBrace(code: string, openPos: number): number {
    let depth = 1;
    let i = openPos + 1;
    while (i < code.length && depth > 0) {
        const ch = code[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
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

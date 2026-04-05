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

/** Marker comments embedded in preprocessed code to identify state/derived declarations */
export const STATE_MARKER = '/*@s*/';
export const DERIVED_MARKER = '/*@d*/';

export interface PreprocessResult {
    /** The transformed source that OXC can parse */
    code: string;
    /** Components found during pre-processing */
    components: ComponentMeta[];
    /** All names ever declared with `state` (for reactive var tracking, not scoping) */
    stateVars: string[];
    /** All names ever declared with `derived` (for reactive var tracking, not scoping) */
    derivedVars: string[];
    /** Renamed params: componentName → { localName → externalName } */
    renamedParams: Record<string, Record<string, string>>;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Find the component that owns a given source offset ('' if module-level) */
function findOwnerComponent(componentPositions: { name: string; start: number }[], offset: number): string {
    let owner = '';
    for (const cp of componentPositions) {
        if (offset >= cp.start) owner = cp.name;
        else break;
    }
    return owner;
}

// ── Pre-process ────────────────────────────────────────────────────

export function preprocess(source: string): PreprocessResult {
    let code = source;
    const components: ComponentMeta[] = [];
    const stateVars: string[] = [];
    const derivedVars: string[] = [];

    // 1. Transform component declarations
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

    // 1b. Transform renamed params: 'ext-name' as localName → localName
    //     Store the external→local mapping per component so the analyzer can set externalName on ParamIR.
    const renamedParams: Record<string, Record<string, string>> = {};
    // Build a position → component name mapping from the component list
    // We search the *original* source for 'component Name(' to find positions
    const componentPositions: { name: string; start: number }[] = [];
    for (const comp of components) {
        const re = new RegExp(`\\bcomponent\\s+${comp.name}\\s*\\(`);
        const m = source.match(re);
        if (m && m.index != null) {
            componentPositions.push({ name: comp.name, start: m.index });
        }
    }
    componentPositions.sort((a, b) => a.start - b.start);

    code = code.replace(
        /(['"])([^'"]+)\1\s+as\s+(\w+)/g,
        (_match, _quote, externalName, localName, offset) => {
            const ownerComp = findOwnerComponent(componentPositions, offset);
            if (ownerComp) {
                if (!renamedParams[ownerComp]) renamedParams[ownerComp] = {};
                renamedParams[ownerComp][localName] = externalName;
            }
            return localName;
        },
    );

    // 1c. Transform `bind paramName` in function params → `__bind__paramName`
    //     so OXC can parse it as a valid identifier, and the analyzer can detect it.
    code = code.replace(/\bbind\s+(\w+)/g, '__bind__$1');

    // 2. Transform `state varName = expr` → `let varName /*@s*/ = expr`
    //    The /*@s*/ marker lets the analyzer identify this as a state declaration
    //    regardless of scope, without relying on name matching alone.
    code = code.replace(
        /(\bexport\s+)?(?<!\.)(?<!\w)\bstate\s+(\w+)\s*(?==)/g,
        (_match, exportKw, name) => {
            stateVars.push(name);
            return `${exportKw || ''}let ${name} ${STATE_MARKER} `;
        },
    );

    // 3. Transform `derived varName = expr` → `const varName /*@d*/ = expr`
    code = code.replace(
        /(\bexport\s+)?(?<!\.)(?<!\w)\bderived\s+(\w+)\s*(?==)/g,
        (_match, exportKw, name) => {
            derivedVars.push(name);
            return `${exportKw || ''}const ${name} ${DERIVED_MARKER} `;
        },
    );

    // 4. Transform `render (` blocks → `return (<>` ... `</>)`
    code = transformRenderBlocks(code);

    // 5. Transform `bind:{x}` shorthand → `bind:value={x}`
    code = code.replace(/bind:\{(\w+)\}/g, 'bind:value={$1}');

    // 6. Wrap function bindings: `bind:prop={get, set}` → `bind:prop={[get, set]}`
    //    so OXC can parse them (JSX disallows the comma operator)
    code = wrapFunctionBindings(code);

    // 7. Transform control flow blocks ({if}, {for}) into parseable __if()/__for() calls
    code = transformControlFlowBlocks(code);

    return { code, components, stateVars, derivedVars, renamedParams };
}

// ── Function binding wrapper ───────────────────────────────────────

/**
 * Finds `bind:prop={expr1, expr2}` and wraps as `bind:prop={[expr1, expr2]}`
 * so OXC doesn't reject the comma operator inside JSX.
 */
function wrapFunctionBindings(code: string): string {
    const bindRegex = /bind:\w+\s*=\s*\{/g;
    let match;
    let result = '';
    let lastIndex = 0;

    while ((match = bindRegex.exec(code)) !== null) {
        const openBrace = match.index + match[0].length - 1;
        const closeBrace = findMatchingBrace(code, openBrace);
        if (closeBrace === -1) continue;

        const inner = code.slice(openBrace + 1, closeBrace);
        if (hasTopLevelComma(inner)) {
            result += code.slice(lastIndex, openBrace + 1);
            result += `[${inner}]`;
            result += '}';
            lastIndex = closeBrace + 1;
        }
    }

    result += code.slice(lastIndex);
    return result;
}

function hasTopLevelComma(expr: string): boolean {
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === ',' && depth === 0) return true;
        else if (ch === '\'' || ch === '"') {
            i = skipString(expr, i) - 1;
        } else if (ch === '`') {
            i = skipTemplateLiteral(expr, i) - 1;
        }
    }
    return false;
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

            if (/^switch\s*\(/.test(code.slice(j))) {
                const parsed = tryParseSwitchBlock(code, i);
                if (parsed) {
                    result += parsed.text;
                    i = parsed.end;
                    continue;
                }
            }

            if (/^try\s*\{/.test(code.slice(j))) {
                const parsed = tryParseTryBlock(code, i);
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

    const output = buildIfCall(transformed, stmts[0]);
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
            // else if — recurse to build nested __if, wrapped in expression container
            const nestedCall = buildIfCall(source, stmt.alternate);
            return `__if(() => (${condition}), () => (<>${trueBody}</>), () => (<>{${nestedCall}}</>))`;
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

    // Extract body (everything after the header parens)
    const bodyText = content.slice(parenEnd + 1).trim();
    if (!bodyText.startsWith('{') || !bodyText.endsWith('}')) return null;
    const body = bodyText.slice(1, -1).trim();

    // Recursively transform nested control flow
    const transformedBody = transformControlFlowBlocks(body);

    // Try parsing the full header to determine loop type
    const forSource = `for (${fullHeader}) {}`;
    const fullResult = parseSync('for-block.tsx', forSource, {
        sourceType: 'script',
        lang: 'tsx',
    });

    if (fullResult.errors.length === 0 && fullResult.program.body.length > 0) {
        const forStmt = fullResult.program.body[0] as any;

        // for...in: for (const key in obj)
        if (forStmt.type === 'ForInStatement') {
            const leftSource = forSource.slice(forStmt.left.start, forStmt.left.end);
            const objectExpr = forSource.slice(forStmt.right.start, forStmt.right.end);
            const paramPattern = leftSource.replace(/^(?:const|let|var)\s+/, '');
            const text = `{__for(() => (Object.keys(${objectExpr})), (${paramPattern}) => (<>${transformedBody}</>))}`;
            return { text, end: outerClose + 1 };
        }

        // C-style for: for (let i = 0; i < 10; i++)
        if (forStmt.type === 'ForStatement') {
            const initSrc = forStmt.init ? forSource.slice(forStmt.init.start, forStmt.init.end) : '';
            const testSrc = forStmt.test ? forSource.slice(forStmt.test.start, forStmt.test.end) : '';
            const updateSrc = forStmt.update ? forSource.slice(forStmt.update.start, forStmt.update.end) : '';

            // Extract loop variable name from init
            let loopVar = '__i';
            if (forStmt.init?.type === 'VariableDeclaration' && forStmt.init.declarations?.[0]?.id?.name) {
                loopVar = forStmt.init.declarations[0].id.name;
            } else if (forStmt.init?.type === 'AssignmentExpression' && forStmt.init.left?.name) {
                loopVar = forStmt.init.left.name;
            }

            const collectionFn = `{ const __a = []; for (${initSrc}; ${testSrc}; ${updateSrc}) __a.push(${loopVar}); return __a; }`;
            const text = `{__for(() => ${collectionFn}, (${loopVar}) => (<>${transformedBody}</>))}`;
            return { text, end: outerClose + 1 };
        }

        // for...of without extensions
        if (forStmt.type === 'ForOfStatement') {
            const leftSource = forSource.slice(forStmt.left.start, forStmt.left.end);
            const collection = forSource.slice(forStmt.right.start, forStmt.right.end);
            const paramPattern = leftSource.replace(/^(?:const|let|var)\s+/, '');
            const text = `{__for(() => (${collection}), (${paramPattern}) => (<>${transformedBody}</>))}`;
            return { text, end: outerClose + 1 };
        }
    }

    // Full header didn't parse — try for-of with DarTsx extensions (index, key)
    const parts = fullHeader.split(';').map((s) => s.trim());
    const mainPart = parts[0];

    let indexName: string | null = null;
    let keyExpr: string | null = null;
    for (let k = 1; k < parts.length; k++) {
        const part = parts[k];
        if (part.startsWith('index ')) indexName = part.slice(6).trim();
        else if (part.startsWith('key ')) keyExpr = part.slice(4).trim();
    }

    const forOfSource = `for (${mainPart}) {}`;
    const forOfResult = parseSync('for-block.tsx', forOfSource, {
        sourceType: 'script',
        lang: 'tsx',
    });
    if (forOfResult.errors.length > 0 || forOfResult.program.body.length === 0) return null;

    const forOfStmt = forOfResult.program.body[0];
    if (forOfStmt.type !== 'ForOfStatement') return null;

    const leftSource = forOfSource.slice(forOfStmt.left.start, forOfStmt.left.end);
    const collection = forOfSource.slice(forOfStmt.right.start, forOfStmt.right.end);
    const paramPattern = leftSource.replace(/^(?:const|let|var)\s+/, '');

    const params = indexName ? `${paramPattern}, ${indexName}` : paramPattern;
    let text: string;
    if (keyExpr) {
        text = `{__for(() => (${collection}), (${params}) => (<>${transformedBody}</>), (${paramPattern}) => (${keyExpr}))}`;
    } else {
        text = `{__for(() => (${collection}), (${params}) => (<>${transformedBody}</>))}`;
    }

    return { text, end: outerClose + 1 };
}

function tryParseSwitchBlock(code: string, outerBrace: number): ControlFlowResult | null {
    const outerClose = findMatchingBrace(code, outerBrace);
    const content = code.slice(outerBrace + 1, outerClose).trim();

    if (!content.startsWith('switch')) return null;

    // Recursively transform nested control flow blocks first
    const transformed = transformControlFlowBlocks(content);

    // Parse the transformed switch statement with OXC
    const result = parseSync('switch-block.tsx', transformed, {
        sourceType: 'script',
        lang: 'tsx',
    });
    if (result.errors.length > 0) return null;

    const stmts = result.program.body;
    if (stmts.length === 0 || stmts[0].type !== 'SwitchStatement') return null;

    const switchStmt = stmts[0];
    const discriminant = transformed.slice(switchStmt.discriminant.start, switchStmt.discriminant.end);
    const switchCases = switchStmt.cases || [];

    // Group cases with fall-through support
    const groups: { values: string[]; isDefault: boolean; body: string }[] = [];
    let pendingValues: string[] = [];
    let pendingDefault = false;

    for (let ci = 0; ci < switchCases.length; ci++) {
        const sc = switchCases[ci];

        if (sc.test) {
            pendingValues.push(transformed.slice(sc.test.start, sc.test.end));
        } else {
            pendingDefault = true;
        }

        const consequent: any[] = sc.consequent || [];
        const bodyStmts = consequent.filter((s: any) => s.type !== 'BreakStatement');
        const hasBreak = consequent.some((s: any) => s.type === 'BreakStatement');
        const isLast = ci === switchCases.length - 1;

        // A case terminates its group if it has body content, a break, or is the last case
        if (bodyStmts.length > 0 || hasBreak || isLast) {
            let body = '';
            if (bodyStmts.length > 0) {
                const start = bodyStmts[0].start;
                const end = bodyStmts[bodyStmts.length - 1].end;
                body = transformed.slice(start, end);
            }

            groups.push({
                values: [...pendingValues],
                isDefault: pendingDefault,
                body: body.trim(),
            });
            pendingValues = [];
            pendingDefault = false;
        }
    }

    // Build __switch call: discriminant fn, then pairs of (values, body fn)
    const args: string[] = [`() => (${discriminant})`];
    for (const g of groups) {
        if (g.isDefault) {
            args.push('null');
        } else {
            args.push(`[${g.values.join(', ')}]`);
        }
        args.push(`() => (<>${g.body}</>)`);
    }

    const output = `__switch(${args.join(', ')})`;
    return { text: `{${output}}`, end: outerClose + 1 };
}

function tryParseTryBlock(code: string, outerBrace: number): ControlFlowResult | null {
    const outerClose = findMatchingBrace(code, outerBrace);
    const content = code.slice(outerBrace + 1, outerClose).trim();

    if (!content.startsWith('try')) return null;

    // Manually parse: try { ... } [pending { ... }] [catch (param) { ... }]
    // Can't use OXC because "pending { }" isn't valid JavaScript
    let pos = 3; // skip "try"
    while (pos < content.length && /\s/.test(content[pos])) pos++;
    if (content[pos] !== '{') return null;

    const tryBodyEnd = findMatchingBrace(content, pos);
    const tryBody = content.slice(pos + 1, tryBodyEnd).trim();
    pos = tryBodyEnd + 1;

    let catchParam: string | null = null;
    let catchBody: string | null = null;
    let pendingBody: string | null = null;

    // Look for pending and catch blocks (in any order)
    while (pos < content.length) {
        while (pos < content.length && /\s/.test(content[pos])) pos++;
        if (pos >= content.length) break;

        const remaining = content.slice(pos);

        if (remaining.startsWith('pending')) {
            pos += 7;
            while (pos < content.length && /\s/.test(content[pos])) pos++;
            if (content[pos] !== '{') return null;
            const pendEnd = findMatchingBrace(content, pos);
            pendingBody = content.slice(pos + 1, pendEnd).trim();
            pos = pendEnd + 1;
        } else if (remaining.startsWith('catch')) {
            pos += 5;
            while (pos < content.length && /\s/.test(content[pos])) pos++;

            // Extract catch parameter
            if (content[pos] === '(') {
                const parenClose = findMatchingParen(content, pos);
                catchParam = content.slice(pos + 1, parenClose).trim();
                pos = parenClose + 1;
            }

            while (pos < content.length && /\s/.test(content[pos])) pos++;
            if (content[pos] !== '{') return null;
            const catchEnd = findMatchingBrace(content, pos);
            catchBody = content.slice(pos + 1, catchEnd).trim();
            pos = catchEnd + 1;
        } else {
            break;
        }
    }

    // Transform nested control flow in bodies
    const transformedTryBody = transformControlFlowBlocks(tryBody);
    const transformedCatchBody = catchBody ? transformControlFlowBlocks(catchBody) : null;
    const transformedPendingBody = pendingBody ? transformControlFlowBlocks(pendingBody) : null;

    // Build __try call: tryFn [, catchFn] [, pendingFn]
    let call = `__try(() => (<>${transformedTryBody}</>)`;

    if (transformedCatchBody !== null) {
        const param = catchParam || 'e';
        call += `, (${param}) => (<>${transformedCatchBody}</>)`;
    } else if (transformedPendingBody !== null) {
        call += ', null';
    }

    if (transformedPendingBody !== null) {
        call += `, () => (<>${transformedPendingBody}</>)`;
    }

    call += ')';

    return { text: `{${call}}`, end: outerClose + 1 };
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

/**
 * Phase 3 — Transform (jsx() runtime)
 *
 * Converts the analysis IR into JavaScript code using $.jsx() runtime calls
 * for DOM creation with fine-grained reactivity. No templates, no DOM navigation.
 */
import type {
    AnalysisResult,
    ComponentIR,
    JSXNodeIR,
    JSXElementIR,
    JSXFragmentIR,
    JSXIfBlockIR,
    JSXForBlockIR,
    JSXSwitchBlockIR,
    JSXTryBlockIR,
    JSXAttrIR,
    JSXExpressionIR,
} from '../2-analyze';
import { wrapReadsInGet, transformEventHandler, transformBodyStatement } from './expr';

// ── Main entry ─────────────────────────────────────────────────────

export function transform(analysis: AnalysisResult): string {
    const lines: string[] = [];

    const needsRuntime =
        analysis.components.length > 0 ||
        analysis.moduleStateVars.length > 0 ||
        analysis.moduleDerivedVars.length > 0 ||
        analysis.moduleFunctions.length > 0;
    if (needsRuntime) {
        lines.push("import $ from 'dartsx/internal/client';");
    }

    for (const imp of analysis.userImports) {
        lines.push(imp);
    }
    if (lines.length > 0) lines.push('');

    for (const s of analysis.moduleStateVars) {
        const prefix = s.exported ? 'export ' : '';
        lines.push(`${prefix}let ${s.name} = $.state(${s.initExpr});`);
    }

    for (const d of analysis.moduleDerivedVars) {
        const prefix = d.exported ? 'export ' : '';
        const wrappedExpr = wrapReadsInGet(d.expr, analysis.moduleReactiveVars);
        lines.push(`${prefix}const ${d.name} = $.derived(() => ${wrappedExpr});`);
    }

    if (analysis.moduleStateVars.length > 0 || analysis.moduleDerivedVars.length > 0) {
        lines.push('');
    }

    for (const fn of analysis.moduleFunctions) {
        const mergedReactive = new Set(analysis.moduleReactiveVars);
        for (const p of fn.reactiveParams) mergedReactive.add(p);
        lines.push(fn.signature);
        for (const stmt of fn.bodyStatements) {
            lines.push(`    ${transformBodyStatement(stmt, mergedReactive, analysis.reactiveCallTargets)}`);
        }
        lines.push('}');
    }
    if (analysis.moduleFunctions.length > 0) lines.push('');

    for (const stmt of analysis.moduleStatements) {
        lines.push(transformBodyStatement(stmt, analysis.moduleReactiveVars, analysis.reactiveCallTargets));
    }
    if (analysis.moduleStatements.length > 0) lines.push('');

    for (const comp of analysis.components) {
        lines.push(transformComponent(comp, analysis.reactiveCallTargets));
        lines.push('');
    }

    return lines.join('\n');
}

// ── Component code generation ──────────────────────────────────────

function transformComponent(comp: ComponentIR, reactiveCallTargets?: Map<string, Set<number>>): string {
    const lines: string[] = [];
    const hasProps = comp.params.length > 0;

    const exportPrefix = comp.meta.isExport
        ? comp.meta.isDefault
            ? 'export default '
            : 'export '
        : '';
    const asyncPrefix = comp.meta.isAsync ? 'async ' : '';
    const propsParam = hasProps ? '$$props' : '';
    lines.push(`${exportPrefix}${asyncPrefix}function ${comp.meta.name}(${propsParam}) {`);

    for (const s of comp.stateVars) {
        lines.push(`    let ${s.name} = $.state(${s.initExpr});`);
    }

    for (const d of comp.derivedVars) {
        const wrappedExpr = wrapReadsInGet(d.expr, comp.reactiveVars);
        lines.push(`    const ${d.name} = $.derived(() => ${wrappedExpr});`);
    }

    if (hasProps) {
        for (const p of comp.params) {
            if (p.isRest) {
                lines.push(`    let ${p.name} = $$props;`);
            } else if (p.isBind) {
                const propKey = p.externalName || p.name;
                const args = p.defaultValue
                    ? `$$props, '${propKey}', ${p.defaultValue}`
                    : `$$props, '${propKey}'`;
                lines.push(`    let ${p.name} = $.prop.bind(${args});`);
            } else {
                const propKey = p.externalName || p.name;
                const args = p.defaultValue
                    ? `$$props, '${propKey}', ${p.defaultValue}`
                    : `$$props, '${propKey}'`;
                lines.push(`    const ${p.name} = $.prop(${args});`);
            }
        }
    }

    if (comp.stateVars.length || comp.derivedVars.length || hasProps) {
        lines.push('');
    }

    for (const stmt of comp.bodyStatements) {
        lines.push(`    ${transformBodyStatement(stmt, comp.reactiveVars, reactiveCallTargets)}`);
    }

    const jsxCode = emitJSXNode(comp.jsx, comp.reactiveVars, '    ');
    lines.push(`    return ${jsxCode};`);
    lines.push('}');

    return lines.join('\n');
}

// ── JSX node emission ──────────────────────────────────────────────

function emitJSXNode(node: JSXNodeIR, reactiveVars: Set<string>, indent: string): string {
    switch (node.type) {
        case 'element':
            return emitElement(node as JSXElementIR, reactiveVars, indent);
        case 'fragment':
            return emitFragment(node as JSXFragmentIR, reactiveVars, indent);
        case 'text': {
            const text = normalizeJSXText(node.value, true, true);
            if (text.length === 0) return 'null';
            return JSON.stringify(text);
        }
        case 'expression':
            return emitChildExpression(node as JSXExpressionIR, reactiveVars);
        case 'if_block':
            return emitIfBlock(node as JSXIfBlockIR, reactiveVars, indent);
        case 'for_block':
            return emitForBlock(node as JSXForBlockIR, reactiveVars, indent);
        case 'switch_block':
            return emitSwitchBlock(node as JSXSwitchBlockIR, reactiveVars, indent);
        case 'try_block':
            return emitTryBlock(node as JSXTryBlockIR, reactiveVars, indent);
        default:
            return 'null';
    }
}

function emitFragment(node: JSXFragmentIR, reactiveVars: Set<string>, indent: string): string {
    const childStrs = emitChildrenArray(node.children, reactiveVars, indent);
    if (childStrs.length === 0) return 'null';
    if (childStrs.length === 1) return childStrs[0];
    return `$.jsx($.Fragment, { children: [${childStrs.join(', ')}] })`;
}

function emitElement(node: JSXElementIR, reactiveVars: Set<string>, indent: string): string {
    if (node.isComponent) return emitComponentCall(node, reactiveVars, indent);

    const propEntries: string[] = [];

    for (const attr of node.attributes) {
        emitAttr(attr, propEntries, reactiveVars, false);
    }

    if (!node.selfClosing) {
        const childStrs = emitChildrenArray(node.children, reactiveVars, indent);
        if (childStrs.length > 0) {
            propEntries.push(`children: [${childStrs.join(', ')}]`);
        }
    }

    if (propEntries.length === 0) {
        return `$.jsx("${node.tag}")`;
    }
    return `$.jsx("${node.tag}", { ${propEntries.join(', ')} })`;
}

function emitComponentCall(node: JSXElementIR, reactiveVars: Set<string>, indent: string): string {
    const propEntries: string[] = [];

    for (const attr of node.attributes) {
        emitAttr(attr, propEntries, reactiveVars, true);
    }

    if (!node.selfClosing) {
        const childStrs = emitChildrenArray(node.children, reactiveVars, indent);
        if (childStrs.length > 0) {
            propEntries.push(`children: [${childStrs.join(', ')}]`);
        }
    }

    if (propEntries.length === 0) {
        return `${node.tag}()`;
    }
    return `${node.tag}({ ${propEntries.join(', ')} })`;
}

// ── Attribute emission ─────────────────────────────────────────────

function emitAttr(attr: JSXAttrIR, entries: string[], reactiveVars: Set<string>, isComponent: boolean): void {
    switch (attr.kind) {
        case 'static': {
            const val = attr.value === 'true' ? 'true' : JSON.stringify(attr.value || '');
            entries.push(isComponent ? `${attr.name}: () => ${val}` : `${attr.name}: ${val}`);
            break;
        }
        case 'dynamic': {
            const wrapped = wrapReadsInGet(attr.value || '', reactiveVars);
            if (isComponent) {
                entries.push(`${attr.name}: () => ${wrapped}`);
            } else if (wrapped !== (attr.value || '')) {
                entries.push(`${attr.name}: () => ${wrapped}`);
            } else {
                entries.push(`${attr.name}: ${attr.value}`);
            }
            break;
        }
        case 'event': {
            const handler = transformEventHandler(attr.value || '', reactiveVars);
            entries.push(`${attr.name}: ${handler}`);
            break;
        }
        case 'bind': {
            if (attr.bindProperty && attr.value) {
                entries.push(`"bind:${attr.bindProperty}": ${attr.value}`);
            }
            break;
        }
        case 'spread': {
            entries.push(`...${attr.value}`);
            break;
        }
    }
}

// ── Children ───────────────────────────────────────────────────────

function emitChildrenArray(children: JSXNodeIR[], reactiveVars: Set<string>, indent: string): string[] {
    const result: string[] = [];

    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const isFirst = i === 0;
        const isLast = i === children.length - 1;

        if (child.type === 'text') {
            const text = normalizeJSXText(child.value, isFirst, isLast);
            if (text.length === 0) continue;
            // Drop whitespace-only text nodes between non-text siblings (just formatting)
            if (text.trim().length === 0 && !isFirst && !isLast) {
                const prev = children[i - 1];
                const next = children[i + 1];
                if (prev.type !== 'text' && prev.type !== 'expression' &&
                    next.type !== 'text' && next.type !== 'expression') {
                    continue;
                }
            }
            result.push(JSON.stringify(text));
            continue;
        }

        if (child.type === 'expression') {
            result.push(emitChildExpression(child as JSXExpressionIR, reactiveVars));
            continue;
        }

        result.push(emitJSXNode(child, reactiveVars, indent));
    }

    return result;
}

function emitChildExpression(node: JSXExpressionIR, reactiveVars: Set<string>): string {
    const wrapped = wrapReadsInGet(node.raw, reactiveVars);
    if (wrapped !== node.raw) {
        return `() => ${wrapped}`;
    }
    return node.raw;
}

// ── Control flow ───────────────────────────────────────────────────

function emitIfBlock(node: JSXIfBlockIR, reactiveVars: Set<string>, indent: string): string {
    const condExpr = wrapReadsInGet(node.condition, reactiveVars);
    const trueBody = emitBranchReturn(node.trueBranch, reactiveVars, indent);

    let result = `$.if(() => ${condExpr}, () => ${trueBody}`;
    if (node.falseBranch) {
        const falseBody = emitBranchReturn(node.falseBranch, reactiveVars, indent);
        result += `, () => ${falseBody}`;
    }
    result += ')';
    return result;
}

function emitForBlock(node: JSXForBlockIR, reactiveVars: Set<string>, indent: string): string {
    const collExpr = node.collection.trimStart().startsWith('{')
        ? transformBodyStatement(node.collection, reactiveVars)
        : wrapReadsInGet(node.collection, reactiveVars);
    const params = node.indexName ? `${node.itemName}, ${node.indexName}` : node.itemName;
    const bodyExpr = emitBranchReturn(node.body, reactiveVars, indent);

    let result = `$.for(() => ${collExpr}, (${params}) => ${bodyExpr}`;
    if (node.keyExpr) {
        const keyExpr = wrapReadsInGet(node.keyExpr, reactiveVars);
        result += `, (${node.itemName}) => ${keyExpr}`;
    }
    result += ')';
    return result;
}

function emitSwitchBlock(node: JSXSwitchBlockIR, reactiveVars: Set<string>, indent: string): string {
    const discExpr = wrapReadsInGet(node.discriminant, reactiveVars);

    const caseStrs: string[] = [];
    for (const c of node.cases) {
        const valuesStr = c.values === null ? 'null' : `[${c.values.join(', ')}]`;
        const bodyExpr = emitBranchReturn(c.body, reactiveVars, indent);
        caseStrs.push(`{ values: ${valuesStr}, fn: () => ${bodyExpr} }`);
    }

    return `$.switch(() => ${discExpr}, [${caseStrs.join(', ')}])`;
}

function emitTryBlock(node: JSXTryBlockIR, reactiveVars: Set<string>, indent: string): string {
    const tryBody = emitBranchReturn(node.tryBranch, reactiveVars, indent);

    let result = `$.try(() => ${tryBody}`;

    if (node.catchBranch) {
        const param = node.catchParam || 'e';
        const catchBody = emitBranchReturn(node.catchBranch, reactiveVars, indent);
        result += `, (${param}) => ${catchBody}`;
    } else if (node.pendingBranch) {
        result += ', undefined';
    }

    if (node.pendingBranch) {
        const pendBody = emitBranchReturn(node.pendingBranch, reactiveVars, indent);
        result += `, () => ${pendBody}`;
    }

    result += ')';
    return result;
}

// ── Branch helpers ─────────────────────────────────────────────────

function emitBranchReturn(children: JSXNodeIR[], reactiveVars: Set<string>, indent: string): string {
    const childStrs = emitChildrenArray(children, reactiveVars, indent);
    if (childStrs.length === 0) return 'null';
    if (childStrs.length === 1) return childStrs[0];
    return `$.jsx($.Fragment, { children: [${childStrs.join(', ')}] })`;
}

// ── Utilities ──────────────────────────────────────────────────────

function normalizeJSXText(text: string, isFirst: boolean, isLast: boolean): string {
    let result = text.replace(/\s*\n\s*/g, ' ');
    if (isFirst) result = result.replace(/^\s+/, '');
    if (isLast) result = result.replace(/\s+$/, '');
    return result;
}

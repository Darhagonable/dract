/**
 * Phase 3 — Transform (DOM-expressions style)
 *
 * Each element gets its own template + factory function with granular effects.
 * Template clones are hoisted to module scope for reuse.
 */
import type {
    ComponentIR,
    JSXNodeIR,
    JSXElementIR,
    JSXFragmentIR,
    JSXAttrIR,
} from '../2-analyze/index.js';
import { wrapReadsInGet, transformEventHandler } from './expr.js';

// ── Main entry ─────────────────────────────────────────────────────

export function transform(components: ComponentIR[]): string {
    const ctx: ModuleContext = {
        templates: [],
        templateMap: new Map(),
        templateNames: { counts: new Map() },
    };

    const componentBlocks: string[] = [];
    for (const comp of components) {
        componentBlocks.push(transformComponent(comp, ctx));
    }

    const lines: string[] = [];

    // Runtime import
    lines.push("import $ from 'dartsx/internal/client';");
    lines.push('');

    // Hoisted template declarations
    for (const t of ctx.templates) {
        lines.push(`const ${t.varName} = $.template(\`${t.html}\`);`);
    }
    if (ctx.templates.length > 0) lines.push('');

    // Component functions
    for (const block of componentBlocks) {
        lines.push(block);
        lines.push('');
    }

    return lines.join('\n');
}

// ── Module-level context (shared across components) ────────────────

interface TemplateDecl {
    varName: string;
    html: string;
}

interface ModuleContext {
    templates: TemplateDecl[];
    /** Dedup: HTML → template var name */
    templateMap: Map<string, string>;
    /** Counter for unique template var names */
    templateNames: NameCounter;
}

function getOrCreateTemplate(ctx: ModuleContext, html: string, tag: string): string {
    const existing = ctx.templateMap.get(html);
    if (existing) return existing;
    const varName = getName(ctx.templateNames, `_${tag}`);
    ctx.templates.push({ varName, html });
    ctx.templateMap.set(html, varName);
    return varName;
}

// ── Name counter for unique variables ──────────────────────────────

interface NameCounter {
    counts: Map<string, number>;
}

function getName(counter: NameCounter, base: string): string {
    const count = counter.counts.get(base) || 0;
    counter.counts.set(base, count + 1);
    return count === 0 ? base : `${base}_${count}`;
}

// ── Component code generation ──────────────────────────────────────

function transformComponent(comp: ComponentIR, ctx: ModuleContext): string {
    const lines: string[] = [];
    const hasProps = comp.params.length > 0;
    const nameCounter: NameCounter = { counts: new Map() };

    // Function signature
    const exportPrefix = comp.meta.isExport
        ? comp.meta.isDefault
            ? 'export default '
            : 'export '
        : '';
    const asyncPrefix = comp.meta.isAsync ? 'async ' : '';
    const propsParam = hasProps ? ', $$props' : '';
    lines.push(`${exportPrefix}${asyncPrefix}function ${comp.meta.name}($$anchor${propsParam}) {`);

    // State declarations
    for (const s of comp.stateVars) {
        lines.push(`    let ${s.name} = $.state(${s.initExpr});`);
    }

    // Derived declarations
    for (const d of comp.derivedVars) {
        const wrappedExpr = wrapReadsInGet(d.expr, comp.reactiveVars);
        lines.push(`    let ${d.name} = $.derived(() => ${wrappedExpr});`);
    }

    // Prop declarations
    if (hasProps) {
        for (const p of comp.params) {
            if (p.isRest) {
                lines.push(`    let ${p.name} = $$props; // TODO: rest props`);
            } else if (p.isBind) {
                lines.push(`    let ${p.name} = $.prop($$props.${p.name});`);
            } else if (p.defaultValue) {
                lines.push(`    let ${p.name} = $.prop($$props.${p.name}, ${p.defaultValue});`);
            } else {
                lines.push(`    let ${p.name} = $$props.${p.name};`);
            }
        }
    }

    if (comp.stateVars.length || comp.derivedVars.length || hasProps) {
        lines.push('');
    }

    // Preserved body statements
    for (const stmt of comp.bodyStatements) {
        lines.push(`    ${stmt}`);
    }

    // Generate element factories and collect the top-level calls for append
    const appendArgs: string[] = [];

    if (comp.jsx.type === 'fragment') {
        for (const child of comp.jsx.children) {
            if (child.type === 'element') {
                const factoryCode = emitElementFactory(child as JSXElementIR, comp.reactiveVars, ctx, nameCounter, '    ');
                lines.push(factoryCode.declaration);
                appendArgs.push(factoryCode.callExpr);
            }
            // text-only children at fragment root are ignored for now (whitespace)
        }
    } else if (comp.jsx.type === 'element') {
        const factoryCode = emitElementFactory(comp.jsx as JSXElementIR, comp.reactiveVars, ctx, nameCounter, '    ');
        lines.push(factoryCode.declaration);
        appendArgs.push(factoryCode.callExpr);
    }

    lines.push('');
    lines.push(`    $.append($$anchor, ${appendArgs.join(', ')});`);
    lines.push('}');

    return lines.join('\n');
}

// ── Element factory emission ───────────────────────────────────────

interface FactoryResult {
    /** The full factory function declaration (const name = () => { ... };) */
    declaration: string;
    /** The expression to call it (the factory name) */
    callExpr: string;
}

function emitElementFactory(
    node: JSXElementIR,
    reactiveVars: Set<string>,
    ctx: ModuleContext,
    nameCounter: NameCounter,
    indent: string,
): FactoryResult {
    const factoryName = getName(nameCounter, node.tag);
    const templateHTML = buildSingleElementHTML(node);
    const tmplVar = getOrCreateTemplate(ctx, templateHTML, node.tag);
    const inner = indent + '    '; // one level deeper

    const bodyLines: string[] = [];

    // Dynamic text content
    const hasDynamicText = node.children.some((c) => c.type === 'expression');
    if (hasDynamicText && !node.selfClosing) {
        bodyLines.push(`${inner}const text = $.child(el);`);
        const textExpr = buildTextTemplateLiteral(node.children, reactiveVars);
        bodyLines.push(`${inner}$.effect(() => {`);
        bodyLines.push(`${inner}    text.data = ${textExpr};`);
        bodyLines.push(`${inner}});`);
    }

    // Static-only child elements (nested)
    if (!hasDynamicText && !node.selfClosing) {
        const childElements = node.children.filter((c) => c.type === 'element') as JSXElementIR[];
        if (childElements.length > 0) {
            let prevChildVar: string | null = null;
            for (let i = 0; i < childElements.length; i++) {
                const childEl = childElements[i];
                const childVar = getName(nameCounter, `${childEl.tag}_el`);
                if (i === 0) {
                    bodyLines.push(`${inner}const ${childVar} = $.firstChild(el);`);
                } else {
                    bodyLines.push(`${inner}const ${childVar} = $.sibling(${prevChildVar}, 2);`);
                }

                const childHasDynamic = childEl.children.some((c) => c.type === 'expression');
                if (childHasDynamic) {
                    bodyLines.push(`${inner}const ${childVar}_text = $.child(${childVar});`);
                    const childTextExpr = buildTextTemplateLiteral(childEl.children, reactiveVars);
                    bodyLines.push(`${inner}$.effect(() => {`);
                    bodyLines.push(`${inner}    ${childVar}_text.data = ${childTextExpr};`);
                    bodyLines.push(`${inner}});`);
                }

                emitAttributeBindings(childEl, childVar, reactiveVars, bodyLines, inner);
                prevChildVar = childVar;
            }
        }
    }

    // Attributes: bindings, events, dynamic attrs on the element itself
    emitAttributeBindings(node, 'el', reactiveVars, bodyLines, inner);

    // Build the $.node() call
    const hasSetup = bodyLines.length > 0;
    let decl: string;
    if (hasSetup) {
        decl = [
            `${indent}const ${factoryName} = $.node(${tmplVar}, (el) => {`,
            ...bodyLines,
            `${indent}});`,
        ].join('\n');
    } else {
        // No setup needed — just clone
        decl = `${indent}const ${factoryName} = ${tmplVar}();`;
    }

    return { declaration: decl, callExpr: factoryName };
}

// ── Emit attribute bindings (events, bind:, dynamic attrs) ─────────

function emitAttributeBindings(
    node: JSXElementIR,
    elVar: string,
    reactiveVars: Set<string>,
    lines: string[],
    indent: string,
): void {
    for (const attr of node.attributes) {
        if (attr.kind === 'bind' && attr.bindProperty && attr.value) {
            if (attr.bindProperty === 'value') {
                lines.push(`${indent}$.bindValue(${elVar}, ${attr.value});`);
            } else {
                lines.push(`${indent}// TODO: $.bind${capitalize(attr.bindProperty)}(${elVar}, ${attr.value});`);
            }
        } else if (attr.kind === 'event') {
            const eventName = attr.name.slice(2);
            const handler = transformEventHandler(attr.value || '', reactiveVars);
            lines.push(`${indent}$.delegated('${eventName}', ${elVar}, ${handler});`);
        } else if (attr.kind === 'dynamic') {
            const val = wrapReadsInGet(attr.value || '', reactiveVars);
            lines.push(`${indent}$.attr(${elVar}, '${attr.name}', ${val});`);
        }
    }
}

// ── Build HTML for a single element (with static children baked in) ─

function buildSingleElementHTML(node: JSXElementIR): string {
    let html = `<${node.tag}`;

    for (const attr of node.attributes) {
        if (attr.kind === 'static' && attr.value !== 'true') {
            html += ` ${attr.name}="${escapeAttr(attr.value || '')}"`;
        } else if (attr.kind === 'static' && attr.value === 'true') {
            html += ` ${attr.name}`;
        }
    }

    if (node.selfClosing) {
        html += '/>';
        return html;
    }

    html += '>';

    const hasDynamic = node.children.some((c) => c.type === 'expression');
    if (hasDynamic) {
        html += ' '; // text node placeholder
    } else {
        for (const child of node.children) {
            if (child.type === 'text') {
                html += normalizeJSXTextForTemplate(child.value);
            } else if (child.type === 'element') {
                html += buildSingleElementHTML(child);
            }
        }
    }

    html += `</${node.tag}>`;
    return html;
}

// ── Text template literal generation ───────────────────────────────

function buildTextTemplateLiteral(children: JSXNodeIR[], reactiveVars: Set<string>): string {
    const parts: string[] = [];

    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const isFirst = i === 0;
        const isLast = i === children.length - 1;

        if (child.type === 'text') {
            let text = normalizeJSXText(child.value, isFirst, isLast);
            text = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
            parts.push(text);
        } else if (child.type === 'expression') {
            const expr = wrapReadsInGet(child.raw, reactiveVars);
            parts.push(`\${${expr} ?? ''}`);
        }
    }

    return '`' + parts.join('') + '`';
}

// ── Utility ────────────────────────────────────────────────────────

function normalizeJSXText(text: string, isFirst: boolean, isLast: boolean): string {
    let result = text.replace(/\s*\n\s*/g, ' ');
    if (isFirst) result = result.replace(/^\s+/, '');
    if (isLast) result = result.replace(/\s+$/, '');
    return result;
}

function normalizeJSXTextForTemplate(text: string): string {
    return text.replace(/\s*\n\s*/g, '').trim();
}

function escapeAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

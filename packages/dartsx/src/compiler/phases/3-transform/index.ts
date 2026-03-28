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
    JSXIfBlockIR,
    JSXForBlockIR,
    JSXAttrIR,
} from '../2-analyze';
import { wrapReadsInGet, transformEventHandler, transformBodyStatement } from './expr';

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
            } else if (p.defaultValue) {
                lines.push(`    let ${p.name} = $.prop($$props.${p.name}, ${p.defaultValue});`);
            } else {
                lines.push(`    let ${p.name} = $.prop($$props.${p.name});`);
            }
        }
    }

    if (comp.stateVars.length || comp.derivedVars.length || hasProps) {
        lines.push('');
    }

    // Preserved body statements (with reactive transforms)
    for (const stmt of comp.bodyStatements) {
        lines.push(`    ${transformBodyStatement(stmt, comp.reactiveVars)}`);
    }

    // Generate element factories and collect the top-level calls for append
    const rootChildren = comp.jsx.type === 'fragment' ? comp.jsx.children : [comp.jsx];
    const hasDynamicRoot = rootChildren.some(
        (c) =>
            (c.type === 'element' && (c as JSXElementIR).isComponent) ||
            c.type === 'if_block' ||
            c.type === 'for_block',
    );

    if (hasDynamicRoot) {
        // Emit in order — individual appends for elements, direct calls for components/blocks
        lines.push('');
        for (const child of rootChildren) {
            if (child.type === 'element' && (child as JSXElementIR).isComponent) {
                const el = child as JSXElementIR;
                const propsStr = buildComponentProps(el, comp.reactiveVars);
                if (propsStr) {
                    lines.push(`    ${el.tag}($$anchor, ${propsStr});`);
                } else {
                    lines.push(`    ${el.tag}($$anchor);`);
                }
            } else if (child.type === 'if_block') {
                emitIfBlock(child as JSXIfBlockIR, '$$anchor', comp.reactiveVars, ctx, nameCounter, lines, '    ');
            } else if (child.type === 'for_block') {
                emitForBlock(child as JSXForBlockIR, '$$anchor', comp.reactiveVars, ctx, nameCounter, lines, '    ');
            } else if (child.type === 'element') {
                const factoryCode = emitElementFactory(
                    child as JSXElementIR,
                    comp.reactiveVars,
                    ctx,
                    nameCounter,
                    '    ',
                );
                lines.push(factoryCode.declaration);
                lines.push(`    $.append($$anchor, ${factoryCode.callExpr});`);
            }
        }
    } else {
        // No components — use batch append
        const appendArgs: string[] = [];
        if (comp.jsx.type === 'fragment') {
            for (const child of comp.jsx.children) {
                if (child.type === 'element') {
                    const factoryCode = emitElementFactory(
                        child as JSXElementIR,
                        comp.reactiveVars,
                        ctx,
                        nameCounter,
                        '    ',
                    );
                    lines.push(factoryCode.declaration);
                    appendArgs.push(factoryCode.callExpr);
                }
            }
        } else if (comp.jsx.type === 'element') {
            const factoryCode = emitElementFactory(
                comp.jsx as JSXElementIR,
                comp.reactiveVars,
                ctx,
                nameCounter,
                '    ',
            );
            lines.push(factoryCode.declaration);
            appendArgs.push(factoryCode.callExpr);
        }

        lines.push('');
        lines.push(`    $.append($$anchor, ${appendArgs.join(', ')});`);
    }

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

    if (!node.selfClosing) {
        const hasComponentChild = node.children.some(
            (c) => c.type === 'element' && (c as JSXElementIR).isComponent,
        );
        const hasElementChild = node.children.some(
            (c) => c.type === 'element' && !(c as JSXElementIR).isComponent,
        );
        const hasControlFlow = node.children.some(
            (c) => c.type === 'if_block' || c.type === 'for_block',
        );
        const hasDynamicText = node.children.some((c) => c.type === 'expression');

        if (!hasComponentChild && !hasElementChild && !hasControlFlow && hasDynamicText) {
            // Pure text/expression children — single text node + effect
            bodyLines.push(`${inner}const text = $.child(el);`);
            const textExpr = buildTextTemplateLiteral(node.children, reactiveVars);
            bodyLines.push(`${inner}$.effect(() => {`);
            bodyLines.push(`${inner}    text.data = ${textExpr};`);
            bodyLines.push(`${inner}});`);
        } else if (hasElementChild || hasComponentChild || hasControlFlow) {
            // Mixed children — sequential navigation
            emitChildrenSequential(
                node.children,
                'el',
                reactiveVars,
                ctx,
                nameCounter,
                bodyLines,
                inner,
            );
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

// ── Sequential children processing (handles element + component mix) ─

function emitChildrenSequential(
    children: JSXNodeIR[],
    parentVar: string,
    reactiveVars: Set<string>,
    ctx: ModuleContext,
    nameCounter: NameCounter,
    bodyLines: string[],
    indent: string,
): void {
    // Filter out whitespace-only text
    const templateNodes: JSXNodeIR[] = [];
    for (const child of children) {
        if (child.type === 'text') {
            const normalized = normalizeJSXTextForTemplate(child.value);
            if (normalized.length > 0) templateNodes.push(child);
        } else {
            templateNodes.push(child);
        }
    }

    let prevVar: string | null = null;

    for (let i = 0; i < templateNodes.length; i++) {
        const child = templateNodes[i];

        if (child.type === 'text') {
            // Static text in template — occupies a DOM position, track for navigation
            if (i < templateNodes.length - 1) {
                const textVar = getName(nameCounter, 'text_node');
                if (prevVar === null) {
                    bodyLines.push(`${indent}const ${textVar} = $.firstChild(${parentVar});`);
                } else {
                    bodyLines.push(`${indent}const ${textVar} = $.sibling(${prevVar}, 1);`);
                }
                prevVar = textVar;
            }
            continue;
        }

        if (child.type === 'expression') {
            // Dynamic expression — placeholder text node (' ') is in the template
            const textVar = getName(nameCounter, 'text');
            if (prevVar === null) {
                bodyLines.push(`${indent}const ${textVar} = $.firstChild(${parentVar});`);
            } else {
                bodyLines.push(`${indent}const ${textVar} = $.sibling(${prevVar}, 1);`);
            }
            const textExpr = wrapReadsInGet(child.raw, reactiveVars);
            bodyLines.push(`${indent}$.effect(() => {`);
            bodyLines.push(`${indent}    ${textVar}.data = \`\${${textExpr} ?? ''}\`;`);
            bodyLines.push(`${indent}});`);
            prevVar = textVar;
            continue;
        }

        if (child.type === 'element') {
            const el = child as JSXElementIR;

            if (el.isComponent) {
                // Component — navigate to <!> anchor and call
                const anchorVar = getName(nameCounter, 'anchor');
                if (prevVar === null) {
                    bodyLines.push(`${indent}const ${anchorVar} = $.firstChild(${parentVar});`);
                } else {
                    bodyLines.push(`${indent}const ${anchorVar} = $.sibling(${prevVar}, 1);`);
                }
                const propsStr = buildComponentProps(el, reactiveVars);
                if (propsStr) {
                    bodyLines.push(`${indent}${el.tag}(${anchorVar}, ${propsStr});`);
                } else {
                    bodyLines.push(`${indent}${el.tag}(${anchorVar});`);
                }
                prevVar = anchorVar;
            } else {
                // Native element — baked into template, navigate to it
                const childVar = getName(nameCounter, `${el.tag}_el`);
                if (prevVar === null) {
                    bodyLines.push(`${indent}const ${childVar} = $.firstChild(${parentVar});`);
                } else {
                    bodyLines.push(`${indent}const ${childVar} = $.sibling(${prevVar}, 1);`);
                }

                const childHasDynamic = el.children.some((c) => c.type === 'expression');
                const childHasComponent = el.children.some(
                    (c) => c.type === 'element' && (c as JSXElementIR).isComponent,
                );
                const childHasElement = el.children.some(
                    (c) => c.type === 'element' && !(c as JSXElementIR).isComponent,
                );

                if (!childHasComponent && !childHasElement && childHasDynamic) {
                    bodyLines.push(`${indent}const ${childVar}_text = $.child(${childVar});`);
                    const childTextExpr = buildTextTemplateLiteral(el.children, reactiveVars);
                    bodyLines.push(`${indent}$.effect(() => {`);
                    bodyLines.push(`${indent}    ${childVar}_text.data = ${childTextExpr};`);
                    bodyLines.push(`${indent}});`);
                } else if (childHasElement || childHasComponent) {
                    emitChildrenSequential(
                        el.children,
                        childVar,
                        reactiveVars,
                        ctx,
                        nameCounter,
                        bodyLines,
                        indent,
                    );
                }

                emitAttributeBindings(el, childVar, reactiveVars, bodyLines, indent);
                prevVar = childVar;
            }
        }

        if (child.type === 'if_block' || child.type === 'for_block') {
            // Control flow block — navigate to <!> anchor
            const anchorVar = getName(nameCounter, 'anchor');
            if (prevVar === null) {
                bodyLines.push(`${indent}const ${anchorVar} = $.firstChild(${parentVar});`);
            } else {
                bodyLines.push(`${indent}const ${anchorVar} = $.sibling(${prevVar}, 1);`);
            }
            if (child.type === 'if_block') {
                emitIfBlock(child as JSXIfBlockIR, anchorVar, reactiveVars, ctx, nameCounter, bodyLines, indent);
            } else {
                emitForBlock(child as JSXForBlockIR, anchorVar, reactiveVars, ctx, nameCounter, bodyLines, indent);
            }
            prevVar = anchorVar;
        }
    }
}

// ── Build component props object ───────────────────────────────────

function buildComponentProps(node: JSXElementIR, reactiveVars: Set<string>): string | null {
    const entries: string[] = [];

    for (const attr of node.attributes) {
        if (attr.kind === 'static' && attr.value !== 'true') {
            entries.push(`${attr.name}: () => "${escapeAttr(attr.value || '')}"`);
        } else if (attr.kind === 'static' && attr.value === 'true') {
            entries.push(`${attr.name}: () => true`);
        } else if (attr.kind === 'dynamic') {
            const wrapped = wrapReadsInGet(attr.value || '', reactiveVars);
            entries.push(`${attr.name}: () => ${wrapped}`);
        } else if (attr.kind === 'bind' && attr.bindProperty && attr.value) {
            entries.push(`${attr.bindProperty}: ${attr.value}`);
        } else if (attr.kind === 'event') {
            const handler = transformEventHandler(attr.value || '', reactiveVars);
            entries.push(`${attr.name}: ${handler}`);
        } else if (attr.kind === 'spread') {
            entries.push(`...${attr.value}`);
        }
    }

    if (entries.length === 0) return null;
    return `{ ${entries.join(', ')} }`;
}

// ── If block emission ──────────────────────────────────────────────

function emitIfBlock(
    node: JSXIfBlockIR,
    anchorVar: string,
    reactiveVars: Set<string>,
    ctx: ModuleContext,
    nameCounter: NameCounter,
    lines: string[],
    indent: string,
): void {
    const condExpr = wrapReadsInGet(node.condition, reactiveVars);
    const inner = indent + '    ';

    // True branch
    const trueBranchCode = emitBranchBody(
        node.trueBranch,
        reactiveVars,
        ctx,
        nameCounter,
        inner,
    );

    lines.push(`${indent}$.if(${anchorVar}, () => ${condExpr}, ($$anchor) => {`);
    lines.push(trueBranchCode);
    if (node.falseBranch) {
        const falseBranchCode = emitBranchBody(
            node.falseBranch,
            reactiveVars,
            ctx,
            nameCounter,
            inner,
        );
        lines.push(`${indent}}, ($$anchor) => {`);
        lines.push(falseBranchCode);
    }
    lines.push(`${indent}});`);
}

// ── For block emission ─────────────────────────────────────────────

function emitForBlock(
    node: JSXForBlockIR,
    anchorVar: string,
    reactiveVars: Set<string>,
    ctx: ModuleContext,
    nameCounter: NameCounter,
    lines: string[],
    indent: string,
): void {
    const collExpr = wrapReadsInGet(node.collection, reactiveVars);
    const inner = indent + '    ';
    const params = node.indexName ? `${node.itemName}, ${node.indexName}` : node.itemName;

    const bodyCode = emitBranchBody(node.body, reactiveVars, ctx, nameCounter, inner);

    if (node.keyExpr) {
        const keyExpr = wrapReadsInGet(node.keyExpr, reactiveVars);
        lines.push(`${indent}$.for(${anchorVar}, () => ${collExpr}, ($$anchor, ${params}) => {`);
        lines.push(bodyCode);
        lines.push(`${indent}}, (${node.itemName}) => ${keyExpr});`);
    } else {
        lines.push(`${indent}$.for(${anchorVar}, () => ${collExpr}, ($$anchor, ${params}) => {`);
        lines.push(bodyCode);
        lines.push(`${indent}});`);
    }
}

// ── Branch body emission (shared by if/for) ────────────────────────

function emitBranchBody(
    children: JSXNodeIR[],
    reactiveVars: Set<string>,
    ctx: ModuleContext,
    nameCounter: NameCounter,
    indent: string,
): string {
    const branchLines: string[] = [];
    const appendArgs: string[] = [];

    for (const child of children) {
        if (child.type === 'element' && !(child as JSXElementIR).isComponent) {
            const factory = emitElementFactory(
                child as JSXElementIR,
                reactiveVars,
                ctx,
                nameCounter,
                indent,
            );
            branchLines.push(factory.declaration);
            appendArgs.push(factory.callExpr);
        } else if (child.type === 'element' && (child as JSXElementIR).isComponent) {
            // Component in branch — just call with $$anchor
            const el = child as JSXElementIR;
            const propsStr = buildComponentProps(el, reactiveVars);
            if (propsStr) {
                branchLines.push(`${indent}${el.tag}($$anchor, ${propsStr});`);
            } else {
                branchLines.push(`${indent}${el.tag}($$anchor);`);
            }
        }
        // text nodes are whitespace — skip
    }

    if (appendArgs.length > 0) {
        branchLines.push(`${indent}$.append($$anchor, ${appendArgs.join(', ')});`);
    }

    return branchLines.join('\n');
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
    const hasStructural = node.children.some(
        (c) =>
            (c.type === 'element' && (c as JSXElementIR).isComponent) ||
            c.type === 'if_block' ||
            c.type === 'for_block',
    );
    const hasNativeElements = node.children.some(
        (c) => c.type === 'element' && !(c as JSXElementIR).isComponent,
    );
    if (hasDynamic && !hasStructural && !hasNativeElements) {
        html += ' '; // text node placeholder
    } else {
        for (const child of node.children) {
            if (child.type === 'text') {
                html += normalizeJSXTextForTemplate(child.value);
            } else if (child.type === 'element' && !(child as JSXElementIR).isComponent) {
                html += buildSingleElementHTML(child as JSXElementIR);
            } else if (child.type === 'element' && (child as JSXElementIR).isComponent) {
                html += '<!>'; // anchor placeholder for component
            } else if (child.type === 'if_block' || child.type === 'for_block') {
                html += '<!>'; // anchor placeholder for control flow
            } else if (child.type === 'expression') {
                html += ' '; // text node placeholder for expression
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

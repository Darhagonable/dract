import $ from 'dartsx/internal/client';

function Button($$props) {
    $.style("5nr2s6", "button[data-dartsx-5nr2s6] {\n  color: var(--dartsx-5nr2s6-0);\n  font-size: var(--dartsx-5nr2s6-1);\n  padding: var(--dartsx-5nr2s6-2) var(--dartsx-5nr2s6-1);\n}\n");

    const color = $.prop($$props, 'color');

    let size = $.state(16);
    var $$root = $.jsx("button", { "data-dartsx-5nr2s6": "", children: ["Click me"] });
    $.cssVars($$root, [
        ["button[data-dartsx-5nr2s6]", {
            "--dartsx-5nr2s6-0": () => $.get(color),
            "--dartsx-5nr2s6-1": () => $.get(size) + "px",
            "--dartsx-5nr2s6-2": () => $.get(size) / 2 + "px"
        }],
    ]);
    return $$root;
}

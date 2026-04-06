import $ from 'dartsx/internal/client';

function Form() {
    let form = $.state({ name: "", email: "" });
    return $.jsx("input", { "bind:value": [() => form.name, (v) => form.name = v] });
}

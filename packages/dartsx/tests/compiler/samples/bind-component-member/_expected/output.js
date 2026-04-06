import $ from 'dartsx/internal/client';

function Parent() {
    let form = $.state({ name: "" });
    return $.jsx(Child, { "bind:name": [() => form.name, (v) => form.name = v] });
}

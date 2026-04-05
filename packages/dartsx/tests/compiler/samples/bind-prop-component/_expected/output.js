import $ from 'dartsx/internal/client';

function Parent() {
    let name = $.state("hello");

    return Child({ "bind:name": [() => $.get(name), (v) => $.set(name, v)] });
}

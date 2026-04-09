import $ from 'dartsx/internal/client';

function List() {
    $.style("1uve7w6", "li[data-scope~=\"1uve7w6\"] { padding: 4px; }\n");

    let items = $.state(['a', 'b', 'c']);
    return $.jsx("ul", { "data-scope": "1uve7w6", children: [$.for(() => $.get(items), (item) => $.jsx("li", { "data-scope": "1uve7w6", children: [item] }))] });
}

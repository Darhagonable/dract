import $ from 'dartsx/internal/client';

function search(query: string): string[] {
    if (!$.get(query).trim()) return [];
    return [$.get(query)];
}

function SearchBox() {
    let query = $.state('');
    const results = $.derived(() => search(query));
    return $.jsx("ul", { children: [$.for(() => $.get(results), (r) => $.jsx("li", { children: [r] }))] });
}

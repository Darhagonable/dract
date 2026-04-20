import $ from 'dartsx/internal/client';

export default function TypedComponent() {
    let headings = $.state([]);
    let activeId = $.state('');
    let observer: IntersectionObserver | null = null;
    function processItems(items: { id: string; text: string }[]): string[] {
    return items.map(item => item.text);
  }
    const labels: string[] = processItems($.get(headings));
    return $.jsx("div", { children: [$.jsx("h1", { children: [() => $.get(activeId)] }), $.for(() => labels, (label) => $.jsx("span", { children: [label] }))] });
}

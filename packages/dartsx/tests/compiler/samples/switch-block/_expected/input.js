import $ from 'dartsx/internal/client';

function App() {
    let status = $.state('loading');
    return $.jsx("div", { children: [$.switch(() => $.get(status), [{ values: ['loading'], fn: () => $.jsx("p", { children: ["Loading..."] }) }, { values: ['success'], fn: () => $.jsx("p", { children: ["Success!"] }) }, { values: null, fn: () => $.jsx("p", { children: ["Unknown"] }) }])] });
}

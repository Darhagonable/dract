import $ from 'dartsx/internal/client';

function App() {
    let show = $.state(true);
    return $.jsx("div", { children: [() => { const label = $.get(show) ? 'yes' : 'no'; return $.if(() => $.get(show), () => $.jsx("span", { children: [label] })); }] });
}

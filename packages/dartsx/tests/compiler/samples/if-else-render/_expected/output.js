import $ from 'dartsx/internal/client';

function App() {
    let show = $.state(true);

    return $.jsx("div", { children: [$.if(() => $.get(show), () => { const msg = "visible"; return $.jsx("p", { children: [msg] }); }, () => { const msg = "hidden"; return $.jsx("span", { children: [msg] }); })] });
}

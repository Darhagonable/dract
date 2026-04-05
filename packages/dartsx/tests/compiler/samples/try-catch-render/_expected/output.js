import $ from 'dartsx/internal/client';

function App() {
    return $.jsx("div", { children: [$.try(() => $.jsx("p", { children: ["Content"] }), (e) => { const text = "caught"; return $.jsx("p", { children: [text] }); })] });
}

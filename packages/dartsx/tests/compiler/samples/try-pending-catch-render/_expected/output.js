import $ from 'dartsx/internal/client';

function App() {
    return $.jsx("div", { children: [$.try(() => $.jsx(AsyncContent), (e) => { const text = "error"; return $.jsx("p", { children: [text] }); }, () => { const text = "loading"; return $.jsx("p", { children: [text] }); })] });
}

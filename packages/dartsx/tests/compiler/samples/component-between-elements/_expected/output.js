import $ from 'dartsx/internal/client';

function App() {
    return $.jsx("div", { children: [$.jsx("h1", { children: ["Title"] }), Child(), $.jsx("p", { children: ["Footer"] })] });
}

import $ from 'dartsx/internal/client';

function App() {
    return $.jsx("div", { children: [$.try(() => $.jsx("p", { children: ["Content"] }), (err) => $.jsx("p", { children: ["Failed"] }), () => $.jsx("p", { children: ["Loading..."] }))] });
}

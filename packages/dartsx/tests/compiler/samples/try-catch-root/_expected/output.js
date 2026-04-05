import $ from 'dartsx/internal/client';

function App() {
    return $.try(() => $.jsx("p", { children: ["Content"] }), (e) => $.jsx("p", { children: ["Error"] }));
}

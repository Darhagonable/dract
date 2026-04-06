import $ from 'dartsx/internal/client';

function App() {
    return $.jsx("div", { children: [() => { const msg = 'hi'; return $.jsx("p", { children: [msg] }); }] });
}

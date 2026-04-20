import $ from 'dartsx/internal/client';

function App() {
    let show = $.state(true);
    return $.if(() => $.get(show), () => $.jsx("p", { children: ["Hello"] }));
}

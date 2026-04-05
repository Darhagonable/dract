import $ from 'dartsx/internal/client';

function App() {
    let count = $.state(3);

    return $.jsx("ul", { children: [$.for(() => { const __a = []; for (let i = 0; i < $.get(count); i++) __a.push(i); return __a; }, (i) => { const label = `item-${i}`; return $.jsx("li", { children: [label] }); })] });
}

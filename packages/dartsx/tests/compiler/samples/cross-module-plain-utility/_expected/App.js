import $ from 'dartsx/internal/client';
import { formatCount } from './format'

export function App() {
    let count = $.state(0);
    return $.jsx("div", { children: [$.jsx("p", { children: [() => formatCount(count)] }), $.jsx("button", { onclick: () => $.set(count, $.get(count) + 1), children: ["increment"] })] });
}

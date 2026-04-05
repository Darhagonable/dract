import $ from 'dartsx/internal/client';
import { effect } from 'dartsx'

function App() {
    let count = $.state(0);

    effect(count, (val) => {
    console.log(val);
  })
    return $.jsx("p", { children: [() => $.get(count)] });
}

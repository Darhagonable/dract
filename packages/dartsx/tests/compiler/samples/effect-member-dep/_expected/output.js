import $ from 'dartsx/internal/client';
import { effect } from 'dartsx'

function App() {
    let obj = $.state({ count: 0 });

    effect($.derived(() => obj.count), (count, prevCount) => {
    console.log(count);
  })
    return $.jsx("p", { children: [() => obj.count] });
}

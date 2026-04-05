import $ from 'dartsx/internal/client';
import { watchCount } from './utils'

function App() {
    let obj = $.state({ count: 0 });

    watchCount($.derived(() => obj.count))
    return $.jsx("p", { children: [() => obj.count] });
}

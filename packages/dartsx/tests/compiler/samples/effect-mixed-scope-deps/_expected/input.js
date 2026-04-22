import $ from 'dartsx/internal/client';
import { effect } from 'dartsx'

let theme = $.state('dark');

function Panel($$props) {
    const visible = $.prop($$props, 'visible');

    let size = $.state(0);
    effect([theme, visible, size], ([t], [v], [s]) => { console.log(t, v, s) })
    return $.jsx("p", { children: [() => $.get(theme)] });
}

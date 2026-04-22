import $ from 'dartsx/internal/client';
import { effect } from 'dartsx'

const open = 'hello'
function log(x: any) { console.log(x) }
log(open)

function Dialog($$props) {
    const open = $.prop($$props, 'open');

    effect(open, (isOpen) => { console.log(isOpen) })
    return $.jsx("p", { children: [() => $.get(open)] });
}

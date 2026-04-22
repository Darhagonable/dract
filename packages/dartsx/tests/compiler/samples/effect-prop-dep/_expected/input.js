import $ from 'dartsx/internal/client';
import { effect } from 'dartsx'

function Dialog($$props) {
    const open = $.prop($$props, 'open');

    effect(open, (isOpen) => {
    console.log(isOpen);
  })
    return $.jsx("p", { children: [() => $.get(open)] });
}

use oxc for the compiler

fully typescript 

pnpm becase monorepo


no virtual dom

the idea is that the framework uses signals with state and derived keywords. they can be used anywhere
the compiler will transform it into

import $ from 'dartsx/internal/client';

let name = $.state('world');
let count = $.state(0);
let doubled = $.derived(() => $.get(count) * 2);

let value = $.prop.bind($$props, 'value');
let onSubmit = $.prop($$props, 'onSubmit', alert);

$.get(count)
$.set(count, 1)
$.get(doubled)

$.get(value)
$.set(value, "")





# Tests

use vitest
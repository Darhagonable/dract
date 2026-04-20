import $ from 'dartsx/internal/client';

function Child() {
    const __derived_0 = getContext();
    const count = $.derived(() => __derived_0.count);
    const increment = $.derived(() => __derived_0.increment);
    return $.jsx("button", { onclick: $.get(increment), children: ["Count: ", () => $.get(count)] });
}

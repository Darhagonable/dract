import $ from 'dartsx/internal/client';

let moduleLevel = $.state();
function setup() {
  let fnLevel = $.state()
  return $.get(fnLevel)
}

function App() {
    let count = $.state(0);
    let label = $.state();
    let items = $.state();
    return $.jsx("div", { children: [() => $.get(count), " ", () => $.get(label), " ", () => $.get(items), " ", () => $.get(moduleLevel)] });
}

function teardown() {
  let fnLevel = $.state()
  return $.get(fnLevel)
}

import $ from 'dartsx/internal/client';

function runTest() {
  function Greeting($props) {
    let count = $.state(0);
    const name = $.prop($props, 'name', "world");

    return $.jsx("div", { children: ["Hello ", () => $.get(name), " ", () => $.get(count)] });
}
  return Greeting;
}

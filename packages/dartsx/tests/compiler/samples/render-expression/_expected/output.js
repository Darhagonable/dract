import $ from 'dartsx/internal/client';

function Wrapper() {
    let value = $.state("hello");
    function getValue() {
    return $.get(value)
  }
    return getValue()
}

function WithNull() {
    return null
}

function Conditional($$props) {
    const show = $.prop($$props, 'show');

    if ($.get(show)) {
    return "visible"
  }
    return "hidden"
}

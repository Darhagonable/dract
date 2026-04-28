// Intentional type error: passing string where number expected
export component TypeErrorDemo() {
  state count = 0

  function add(x: number): number {
    return x + 1;
  }

  const result = add("not a number");

  render (
    <div>
      <p>{result}</p>
      <p>{count}</p>
    </div>
  )
}

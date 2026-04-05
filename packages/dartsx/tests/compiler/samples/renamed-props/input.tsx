component RenamedProps(
  'required-renamed' as foo: number,
  'optional-with-default' as baz: number = 3,
) {
  render (
    <div>{foo} {baz}</div>
  )
}

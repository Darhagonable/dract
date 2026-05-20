export component HoverDemo(
  label: string,
  bind value: number,
  'data-id' as dataId: string,
  bind 'aria-label' as ariaLabel: string,
) {
  state count = 0
  derived doubled = count * 2

  render (
    <div>
      <p>{label}: {count}</p>
      <p>doubled: {doubled}</p>
      <p>value: {value}</p>
      <p>id: {dataId}</p>
      <p>aria: {ariaLabel}</p>
    </div>
  )
}

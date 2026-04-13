component Wrapper() {
  state content = null as any
  derived resolved = content ?? 'fallback'
  render (
    <>{resolved}</>
  )
}

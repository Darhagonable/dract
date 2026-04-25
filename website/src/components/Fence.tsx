export component Fence(language: string = '', children: any) {
  render (
    <pre>
      <code>{children}</code>
    </pre>
  )
}

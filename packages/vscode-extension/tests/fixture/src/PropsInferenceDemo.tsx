component Badge(title: string, count: number, active: boolean = false) {
  render (
    <span>{title} {count} {active}</span>
  )
}

export component PropsInferenceDemo() {
  state label = 'Users'
  state total = 3

  render (
    <div>
      <Badge title={label} count={total} active={true} />
      <Badge title={123} count={'bad'} />
    </div>
  )
}

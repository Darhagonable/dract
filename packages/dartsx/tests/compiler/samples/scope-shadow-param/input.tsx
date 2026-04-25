component List() {
  state items = ['a', 'b', 'c']

  const handler = (items: string[]) => {
    console.log(items.length)
    return items.join(', ')
  }

  render (
    <div>
      <p>{handler(items)}</p>
      {for (const item of items) {
        render <span>{item}</span>
      }}
    </div>
  )
}

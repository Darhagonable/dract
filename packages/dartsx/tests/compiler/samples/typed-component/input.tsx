export default component TypedComponent() {
  state headings: { id: string; text: string; level: number }[] = [];
  state activeId: string = '';

  let observer: IntersectionObserver | null = null;

  function processItems(items: { id: string; text: string }[]): string[] {
    return items.map(item => item.text);
  }

  const labels: string[] = processItems(headings);

  render (
    <div>
      <h1>{activeId}</h1>
      {for (const label of labels) {
        render (<span>{label}</span>)
      }}
    </div>
  )
}

export default component IIFEComponent() {
  state items = ['alpha', 'beta', 'gamma'];

  derived grouped = (() => {
    const result = [];
    for (const item of items) {
      result.push({ label: item, upper: item.toUpperCase() });
    }
    return result;
  })();

  render (
    <ul>
      {for (const g of grouped) {
        render (<li>{g.label}: {g.upper}</li>)
      }}
    </ul>
  )
}

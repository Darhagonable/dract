component App() {
  state currentPath = window.location.pathname;
  state someVal = externalVar;

  derived slug = currentPath.startsWith('/docs/') ? currentPath.slice(6) : '';
  derived upper = someVal.toUpperCase();

  render (
    <div>{slug} {upper}</div>
  )
}

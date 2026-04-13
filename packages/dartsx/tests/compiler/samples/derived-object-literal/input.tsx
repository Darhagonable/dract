component App() {
  state count = 0
  derived obj = { count, doubled: count * 2 }
  render <p>{obj.count} - {obj.doubled}</p>
}

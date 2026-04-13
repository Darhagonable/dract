state count = 0
derived obj = { count, doubled: count * 2 }

component App() {
  render <p>{obj.count} - {obj.doubled}</p>
}

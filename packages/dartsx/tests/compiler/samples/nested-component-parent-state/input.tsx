function createFactory() {
  state count = 0
  
  component Counter() {
    render <button onclick={() => count++}>{count}</button>
  }
  
  return Counter
}

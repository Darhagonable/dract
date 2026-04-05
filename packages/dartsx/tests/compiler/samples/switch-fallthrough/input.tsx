component App() {
  state status = 'init'
  render (
    <div>
      {switch (status) {
        case 'init':
        case 'loading':
          <p>Loading...</p>
          break;
        case 'success':
          <p>Done!</p>
          break;
      }}
    </div>
  )
}

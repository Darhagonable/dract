component App() {
  state status = 'loading'
  render (
    <div>
      {switch (status) {
        case 'loading':
          <p>Loading...</p>
          break;
        case 'success':
          <p>Success!</p>
          break;
        default:
          <p>Unknown</p>
      }}
    </div>
  )
}

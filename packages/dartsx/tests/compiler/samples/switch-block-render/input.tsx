component App() {
  state status = 'loading'
  render (
    <div>
      {switch (status) {
        case 'loading':
          const loadMsg = "Please wait...";
          render <p>{loadMsg}</p>
        case 'success':
          const okMsg = "Done!";
          render <p>{okMsg}</p>
        default:
          const defMsg = "Unknown";
          render <p>{defMsg}</p>
      }}
    </div>
  )
}

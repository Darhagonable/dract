component ErrorBoundary() {
  state error = null

  function tryOperation() {
    try {
      riskyCall()
    } catch (error) {
      console.log(error.message)
      reportError(error)
    }
  }

  render (
    <div>
      {if (error) {
        render <p class="error">{error}</p>
      } else {
        render <button onclick={tryOperation}>run</button>
      }}
    </div>
  )
}

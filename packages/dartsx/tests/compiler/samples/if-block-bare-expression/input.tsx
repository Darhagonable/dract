component App() {
  state count = 0
  render (
    <div>
      {if (count > 0) (
        count
      ) else (
        0
      )}
    </div>
  )
}

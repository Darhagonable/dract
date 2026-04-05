component App() {
  render (
    <div>
      {try {
        <p>Content</p>
      } catch (e) {
        const text = "caught";
        render <p>{text}</p>
      }}
    </div>
  )
}

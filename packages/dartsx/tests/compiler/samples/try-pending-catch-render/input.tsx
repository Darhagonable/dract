component App() {
  render (
    <div>
      {try {
        <AsyncContent />
      } pending {
        const text = "loading";
        render <p>{text}</p>
      } catch (e) {
        const text = "error";
        render <p>{text}</p>
      }}
    </div>
  )
}

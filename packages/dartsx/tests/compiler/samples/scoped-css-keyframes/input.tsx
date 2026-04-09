component FadeIn() {
  render (
    <div>
      <p>Animated</p>
    </div>
    <style>
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      div { animation: fadeIn 0.3s; }
      p { color: blue; }
    </style>
  )
}

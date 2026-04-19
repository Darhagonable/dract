// At-rules: @media, @keyframes

export component MediaQuery() {
  render (
    <div>
      <p class="used">Content</p>
    </div>
    <style>
      .used { color: red; }
      @media (max-width: 768px) {
        .used { font-size: 12px; }
        .unused-inside-media { font-size: 10px; }
      }
    </style>
  )
}

export component Keyframes() {
  render (
    <div class="box">animated</div>
    <style>
      .box { animation: fadeIn 0.3s; }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
    </style>
  )
}

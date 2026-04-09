component Responsive() {
  render (
    <div>
      <p>Content</p>
    </div>
    <style>
      div { padding: 16px; }
      @media (max-width: 768px) {
        p { font-size: 12px; }
      }
    </style>
  )
}

export component UnusedCssDemo() {
	const accentColor = '#38BDF8';

  render (
    <div class="card">
      <p class="used">Hello</p>
    </div>
		<style>
			.used { color: red; }
			.unused-selector { color: blue; }

			.card {
				border-radius: 8px;
				border: 2px solid {accentColor};
				padding: 16px;
				transition: box-shadow 0.2s;
				animation: cardEnter 0.3s ease-out;
			}
		</style>
  )

}

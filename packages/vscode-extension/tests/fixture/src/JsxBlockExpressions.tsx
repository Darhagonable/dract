component JsxBlockExpressions() {
  const htmlContent = `<div class="container">
  <p>Hello World</p>
</div>`;

  render (
    <div>
      <p>html: {htmlContent}</p>
      <p class="lead">i key index in of for else if switch case</p>
			{for (const feed of data.feeds; key feed.id; index i) (
        <ul>
          {for (const post of feed.posts; key post.id; index j) (
            <li>
              <button onclick={() => selectedId = post.id}>{post.title}</button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

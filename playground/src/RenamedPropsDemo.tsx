component UserBadge(
  bind 'display-name' as displayName: string,
  'status-text' as statusText: string = "offline",
) {
  render (
    <div style="border: 2px dashed #999; padding: 0.75rem; margin: 0.75rem 0;">
      <h3>Renamed Props</h3>
      <p>Name: {displayName}</p>
      <p>Status: {statusText}</p>
    </div>
  )
}

export component RenamedPropsDemo() {
  render (
    <section>
      <h2>Renamed Props Demo</h2>
      <UserBadge display-name="Alice" status-text="online" />
      <UserBadge display-name="Bob" />
    </section>
  )
}

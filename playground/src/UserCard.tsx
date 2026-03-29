export component UserCard(bind name: string, age: number, active: boolean = true) {
  derived status = active ? "Active" : "Inactive"

  render (
    <div class="user-card">
      <h2>{name}</h2>
      <label>
        Edit name: <input bind:value={name} />
      </label>
      <p>Age: {age}</p>
      <p>Status: {status}</p>
      {for (let i = 0; i < age; i++) {
        <span>🎂</span>
      }}
    </div>
  )
}

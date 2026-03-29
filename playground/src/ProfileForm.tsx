import { UserCard } from "./UserCard";

export default component ProfileForm() {
  state username = "Dar"
  state userAge = 25
  state isActive = false

  render (
    <div class="profile-form" style="border: 10px solid #ccc; padding: 1rem;">
      <h2>Edit Profile</h2>
      <label>
        Name: <input bind:value={username} />
      </label>
      <label>
        Age: <input type="number" bind:value={userAge} />
      </label>
      <label>
        <input type="checkbox" onclick={() => isActive = !isActive} />
        Active
      </label>
      <hr />
      <UserCard bind:name={username} age={userAge} active={isActive} />
      <hr />
      <p>Parent sees name: {username}</p>
    </div>
  )
}

import { UserCard } from "./UserCard";

export default component ProfileForm() {
  state user = {
    name: "Dar",
    age: 25,
    active: false
  }

  render (
    <div class="profile-form" style="border: 10px solid #ccc; padding: 1rem;">
      <h2>Edit Profile</h2>
      <label>
        Name: <input bind:value={user.name} />
      </label>
      <label>
        Age: <input type="number" bind:value={user.age} />
      </label>
      <label>
        <input type="checkbox" bind:checked={user.active} />
        Active
      </label>
      <hr />
      <UserCard bind:name={user.name} age={user.age} active={user.active} />
      <hr />
      <p>Parent sees name: {user.name}</p>
    </div>
  )
}

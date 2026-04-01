import { helper } from "./plain";

export component App(title: string) {
  state count = 0
  derived doubled = count * 2

  state user = {
    name: "Dar",
    age: 25,
  }

  render (
    <div>
      <h1>{title}</h1>
      <p>{count} x 2 = {doubled}</p>
      <p>{helper(count)}</p>
      <input bind:value={user.name} />
      {#if count > 0}
        <p>Positive</p>
      {:else}
        <p>Zero or negative</p>
      {/if}
      {#for item of [1, 2, 3]}
        <span>{item}</span>
      {/for}
    </div>
  )
}

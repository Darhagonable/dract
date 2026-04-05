component App() {
  state todos = [{id: 1, text: "a"}]
  render (
    <ul>
      {for (const todo of todos; index i; key todo.id) {
        <li>{todo.text}</li>
      }}
    </ul>
  )
}

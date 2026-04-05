component App() {
  state todos = [{id: 1, text: "a"}]
  render (
    <ul>
      {for (const todo of todos; key todo.id; index i) {
        <li>{todo.text}</li>
      }}
    </ul>
  )
}

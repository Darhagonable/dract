component Greeting('first-name' as firstName: string) {
  render (<h1>{firstName}</h1>)
}

component App() {
  render (<Greeting first-name="Alice" />)
}

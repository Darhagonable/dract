import { createContext, provide } from "dartsx";

interface GreetingContextValue {
  username: string;
  greeting: string;
  style: "formal" | "casual";
}

// Context with arguments: the factory receives a username and greeting style
const GreetingContext = createContext((username: string, style: "formal" | "casual") => {
  const greeting = style === "formal"
    ? `Good day, ${username}.`
    : `Hey ${username}!`;
  return { username, greeting, style } as GreetingContextValue;
});

component GreetingDisplay() {
  const ctx = GreetingContext();
  render (
    <div>
      <p><strong>{ctx.greeting}</strong></p>
      <p>Style: {ctx.style}</p>
    </div>
  );
}

export default component App() {
  render (
    <div>
      <h2>Context with Arguments</h2>

      <h3>Formal:</h3>
      <FormalProvider />

      <h3>Casual:</h3>
      <CasualProvider />
    </div>
  );
}

component FormalProvider() {
  provide(GreetingContext, "Alice", "formal");
  render <GreetingDisplay />;
}

component CasualProvider() {
  provide(GreetingContext, "Bob", "casual");
  render <GreetingDisplay />;
}

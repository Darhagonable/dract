// Cross-file reactive exports
// Other modules can import these and the compiler will
// treat them as reactive (reads → $.get(), writes → $.set())

export state count = 0
export state user = { name: "Alice", age: 30 }
export derived displayName = `${user.name} (${user.age})`

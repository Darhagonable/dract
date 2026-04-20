/**
 * This function uses a state variable internally.
 * It also has a derived value in the comment.
 */
export function helper(x) {
  return x * 2
}

// component Fake() should not be detected
// state foo = 1
// derived bar = foo + 1
export function other(y) {
  return y + 1
}

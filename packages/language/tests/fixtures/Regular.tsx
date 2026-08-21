import React from 'react';

export function RegularComponent() {
  const [count, setCount] = React.useState(0);
  return <div>{count}</div>;
}

---
title: Quick Start
---

# Quick Start

## Create a project

Create a new directory and initialize it:

```bash
mkdir my-app && cd my-app
npm init -y
npm install dartsx
npm install -D @dartsx/vite-plugin vite
```

## Configure Vite

Create `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import dartsx from '@dartsx/vite-plugin';

export default defineConfig({
  plugins: [dartsx()],
});
```

## Create your first component

Create `src/App.tsx`:

```tsx
export default component App() {
  state name = 'world';

  render (
    <div>
      <h1>Hello, {name}!</h1>
      <input bind:value={name} />
    </div>
  )
}
```

## Mount it

Create `src/main.ts`:

```typescript
import { mount } from 'dartsx';
import App from './App';

mount(App, document.querySelector('app-root')!);
```

Create `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>My App</title>
</head>
<body>
  <app-root></app-root>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

## Run it

```bash
npx vite
```

Open `http://localhost:5173`. Type in the input and watch the heading update in real time.

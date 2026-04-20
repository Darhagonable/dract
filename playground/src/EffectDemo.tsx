import { effect, onCleanup } from 'dartsx';

export component EffectDemo() {
  state count = 0;
  state log: string[] = [];

  effect(count, (newVal, oldVal) => {
    log.push(`${oldVal} → ${newVal}`);
    console.log(count);
  });

  state seconds = 0;
  state running = false;

  effect(running, (isRunning) => {
    if (isRunning) {
      const id = setInterval(() => seconds++, 1000);
      onCleanup(() => clearInterval(id));
    }
  });

  render (
    <div>
      <h2>Effect Demo</h2>

      <h3>Change log</h3>
      <button onclick={count++}>count: {count}</button>
      <ul>
        {for (const entry of log) {
          render <li>{entry}</li>
        }}
      </ul>

      <h3>Timer with cleanup</h3>
      <button onclick={() => running = !running}>
        {running ? 'Stop' : 'Start'}
      </button>
      <p>Elapsed: {seconds}s</p>
    </div>
  )
}

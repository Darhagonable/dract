export const DEFAULT_FILES: Record<string, string> = {
	'main.tsx': `export default component Counter() {
    state count = 0;
    derived doubled = () => count * 2;

    render (
        <div>
            <h1>DarTsx REPL</h1>
            <p>Count: {count}</p>
            <p>Doubled: {doubled}</p>
            <button onclick={() => count++}>+</button>
            <button onclick={() => count--}>-</button>
            <button onclick={() => count = 0}>reset</button>
        </div>
    );
}
`,
};

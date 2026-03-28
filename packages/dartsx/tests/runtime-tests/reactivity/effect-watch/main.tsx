import { effect } from 'dartsx';

export component EffectWatch() {
	state count = 0;
	state log = '';

	effect(count, (value, prev) => {
		log = prev + ' -> ' + value;
	});

	render (
		<button onclick={() => count++}>increment</button>
		<p>{log}</p>
	);
}

import { onMount } from 'dartsx';

export component OnMountBasic() {
	state mounted = false;

	onMount(() => {
		mounted = true;
	});

	render (
		<p>{mounted ? 'Mounted' : 'Not mounted'}</p>
	);
}

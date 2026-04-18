import { createRouter } from '@dartsx-toolkit/router';

// ── Router setup ───────────────────────────────────────────────────

const { Router, Link, RouterContext } = createRouter({
	'/': () => <Home />,
	'/about': () => <About />,
	'/users/:id': (params) => <UserProfile id={params.id} />,
	'/users/:id/settings': () => <UserSettings />,
	'/settings': {
		'/': () => <Settings />,
		'/profile': () => <SettingsProfile />,
		'/account': () => <SettingsAccount />,
	},
	'*': () => <NotFound />,
});

// ── Route components ───────────────────────────────────────────────

component Home() {
	render <h2>Home</h2>
}

component About() {
	const route = RouterContext();

	render (
		<h2>About</h2>
		<p>This is the about page.</p>
		<p>Current URL: {route.pathname}</p>
		<button onclick={() => route.navigation.navigate('/')}>Go Home</button>
	)
}

// Params via props — route handler passes them down
component UserProfile(id: string) {
	render (
		<h2>User: {id} (via props)</h2>
		<p>Params passed from the route handler.</p>
		<Link to="/about">Go to About (via Link)</Link>
	)
}

// Params via context — component reads them itself
component UserSettings() {
	const route = RouterContext('/users/:id/settings');

	render (
		<h2>Settings for user: {route.params.id} (via context)</h2>
		<p>Params read from RouterContext.</p>
		<button onclick={() => route.navigation.navigate('../../..')}>Go Home (via navigate)</button>
	)
}

component Settings() {
	render (
		<h2>Settings</h2>
		<p>General settings page.</p>
	)
}

component SettingsProfile() {
	render (
		<h2>Settings — Profile</h2>
		<p>Edit your display name and avatar.</p>
	)
}

component SettingsAccount() {
	render (
		<h2>Settings — Account</h2>
		<p>Manage your email and password.</p>
	)
}

component NotFound() {
	render <h2>404 — Page not found</h2>
}

// ── Demo component ─────────────────────────────────────────────────

export component RouterDemo() {
	render (
		<h1>Router Demo</h1>
		<nav>
			<Link to="/">Home</Link>
			{' | '}
			<Link to="/about">About</Link>
			{' | '}
			<Link to="/users/42">User (props)</Link>
			{' | '}
			<Link to="/users/42/settings">User Settings (context)</Link>
			{' | '}
			<Link to="/settings">Settings</Link>
			{' | '}
			<Link to="/settings/profile">Profile</Link>
			{' | '}
			<Link to="/settings/account">Account</Link>
		</nav>
		<hr />
		<Router/>
	)
}

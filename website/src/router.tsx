import { createRouter } from '@dartsx-toolkit/router';
import Home from './pages/Home';
import DocPage from './pages/DocPage';

export const { Router, Link, RouterContext } = createRouter({
	'/': () => <Home />,
	'/docs/:slug': ({ slug }) => <DocPage slug={slug} />,
});

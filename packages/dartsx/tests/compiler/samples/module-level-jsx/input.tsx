import Home from './Home';
import DocPage from './DocPage';

export const routes = {
	'/': () => <Home />,
	'/docs/:slug': ({ slug }) => <DocPage slug={slug} />,
};

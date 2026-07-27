import { mount } from 'dartsx';
import App from './App';

const root = document.getElementById('root');
if (root) {
	mount(App, root);
}

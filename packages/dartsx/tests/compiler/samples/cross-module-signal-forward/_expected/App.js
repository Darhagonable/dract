import $ from 'dartsx/internal/client';
import { syncToStorage } from './sync'

export default function App() {
    let name = $.state("alice");
    syncToStorage("name", name)
    return $.jsx("p", { children: [() => $.get(name)] });
}

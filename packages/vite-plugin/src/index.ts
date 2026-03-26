import type { Plugin } from 'vite';

export default function dartsx(): Plugin {
    return {
        name: 'dartsx',
        enforce: 'pre',
        transform(_code, id) {
            if (!id.endsWith('.tsx')) return;
            // TODO: compile dartsx → JS using the compiler
        },
    };
}

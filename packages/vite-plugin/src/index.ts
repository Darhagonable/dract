import type { Plugin } from 'vite';
import { compile } from 'dartsx/compiler';
import fs from 'node:fs';

export default function dartsx(): Plugin {
    return {
        name: 'dartsx',
        enforce: 'pre',
        config() {
            return {
                optimizeDeps: {
                    esbuildOptions: {
                        plugins: [
                            {
                                name: 'dartsx-esbuild',
                                setup(build) {
                                    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
                                        const source = await fs.promises.readFile(args.path, 'utf-8');
                                        const result = compile(source, { filename: args.path });
                                        return { contents: result.code, loader: 'js' };
                                    });
                                },
                            },
                        ],
                    },
                },
            };
        },
        transform(code, id) {
            if (!id.endsWith('.tsx')) return;

            try {
                const result = compile(code, { filename: id });
                return {
                    code: result.code,
                    map: null,
                };
            } catch (e: any) {
                this.error(e.message);
            }
        },
    };
}

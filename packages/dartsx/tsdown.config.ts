import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: {
        'runtime/external/index': 'src/runtime/external/index.ts',
        'runtime/internal/client/index': 'src/runtime/internal/client/index.ts',
        'compiler/index': 'src/compiler/index.ts',
    },
    fixedExtension: false,
    external: ['oxc-parser'],
});

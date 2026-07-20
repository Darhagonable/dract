import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { createGrammarSnapshot } from '@vscode-tmlanguage-snapshot/vscode';

const fixtureDir = path.resolve(import.meta.dirname!, 'fixture');
const snapshot = await createGrammarSnapshot(
  path.resolve(import.meta.dirname!, '../package.json'),
);

const fixtures = readdirSync(path.join(fixtureDir, 'src'));

describe('DarTsx grammar snapshot', () => {
  for (const file of fixtures) {
    it(`tokenizes ${file}`, async () => {
      const result = await snapshot(`tests/fixture/src/${file}`);
      expect(result).toMatchSnapshot();
    });
  }
});

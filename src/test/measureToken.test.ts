import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('--measure token', () => {
  it('is wide enough for the editor toolbar (88ch)', () => {
    expect(read('design/tokens.css')).toMatch(/--measure:\s*88ch;/);
  });

  it('keeps public/tokens.css in sync with design/tokens.css', () => {
    expect(read('public/tokens.css')).toBe(read('design/tokens.css'));
  });
});

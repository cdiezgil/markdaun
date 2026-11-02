import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Brand rule: the primary action is Oro (--gold) with Navy text (--on-gold).
 * --daun is the accent for text; a --daun fill carrying --on-daun text is a
 * primary button painted in the wrong colour (brown in the light theme).
 */
const SRC = join(process.cwd(), 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('primary fill guard', () => {
  it('no production source puts --on-daun text on a --daun fill', () => {
    const offenders = sources(SRC)
      .filter((p) => !relative(SRC, p).startsWith(`test${sep}`))
      .filter((p) => readFileSync(p, 'utf8').includes('var(--on-daun)'))
      .map((p) => relative(process.cwd(), p));
    expect(offenders).toEqual([]);
  });
});

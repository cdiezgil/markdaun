import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { createClient } from './client';
import { AppError } from './errors';

const ref = { owner: 'me', repo: 'vault', branch: 'main' };
const API = 'https://api.github.com';

type Handler = (req: Request) => Response | Promise<Response>;
let handler: Handler = () => new HttpResponse(null, { status: 500 });
const seen: Request[] = [];

const server = setupServer(
  http.all(/.*/, ({ request }) => {
    seen.push(request.clone());
    return handler(request);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  seen.length = 0;
  handler = () => new HttpResponse(null, { status: 500 });
  vi.useRealTimers();
});
afterAll(() => server.close());

const json = (body: unknown, init?: ResponseInit) => HttpResponse.json(body as object, init);

async function kindOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error('expected rejection');
}

// Drives fake timers until the promise settles; real I/O (msw) needs macrotask turns in between.
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  void p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 200 && !done; i++) {
    await new Promise<void>((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(1000);
  }
  return p;
}

describe('github client', () => {
  it('maps statuses to error kinds', async () => {
    const c = createClient('tok', ref);
    const cases: [number, Record<string, string>, string][] = [
      [401, {}, 'Unauthorized'],
      [403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' }, 'RateLimited'],
      [403, {}, 'Forbidden'],
      [404, {}, 'NotFound'],
      [413, {}, 'TooLarge'],
      [500, {}, 'Unknown'],
    ];
    for (const [status, headers, kind] of cases) {
      handler = () => new HttpResponse('{}', { status, headers });
      const err = await kindOf(c.checkAccess());
      expect(err).toBeInstanceOf(AppError);
      expect(err.kind).toBe(kind);
      expect(err.status).toBe(status);
      if (kind === 'RateLimited') expect(err.resetAt).toBe(1700000000 * 1000);
    }
    handler = () => HttpResponse.error();
    expect((await kindOf(c.checkAccess())).kind).toBe('Offline');
  });

  it('checkAccess reads the repo and the branch with auth headers', async () => {
    handler = () => json({});
    await createClient('tok', ref).checkAccess();
    expect(seen.map((r) => new URL(r.url).pathname)).toEqual([
      '/repos/me/vault',
      '/repos/me/vault/branches/main',
    ]);
    expect(seen[0].headers.get('authorization')).toBe('Bearer tok');
    expect(seen[0].headers.get('x-github-api-version')).toBe('2022-11-28');
  });

  it('getTree returns entries from the recursive tree', async () => {
    handler = () =>
      json({
        sha: 'root',
        truncated: false,
        tree: [
          { path: 'a.md', sha: 's1', type: 'blob', size: 3 },
          { path: 'dir', sha: 's2', type: 'tree' },
          { path: 'x', sha: 's3', type: 'commit' },
        ],
      });
    const t = await createClient('tok', ref).getTree();
    expect(t.sha).toBe('root');
    expect(t.entries).toEqual([
      { path: 'a.md', sha: 's1', type: 'blob', size: 3 },
      { path: 'dir', sha: 's2', type: 'tree', size: undefined },
    ]);
  });

  it('walks subtrees when tree is truncated', async () => {
    handler = (req) => {
      const u = new URL(req.url);
      if (u.searchParams.get('recursive')) return json({ sha: 'root', truncated: true, tree: [] });
      if (u.pathname.endsWith('/main'))
        return json({
          sha: 'root',
          truncated: false,
          tree: [
            { path: 'top.md', sha: 'b1', type: 'blob', size: 1 },
            { path: 'sub', sha: 'T1', type: 'tree' },
          ],
        });
      if (u.pathname.endsWith('/T1'))
        return json({
          sha: 'T1',
          truncated: false,
          tree: [
            { path: 'in.md', sha: 'b2', type: 'blob', size: 2 },
            { path: 'deep', sha: 'T2', type: 'tree' },
          ],
        });
      if (u.pathname.endsWith('/T2'))
        return json({
          sha: 'T2',
          truncated: false,
          tree: [{ path: 'z.md', sha: 'b3', type: 'blob', size: 3 }],
        });
      return new HttpResponse(null, { status: 404 });
    };
    const t = await createClient('tok', ref).getTree();
    expect(t.sha).toBe('root');
    expect(t.entries.map((e) => `${e.type}:${e.path}`).sort()).toEqual([
      'blob:sub/deep/z.md',
      'blob:sub/in.md',
      'blob:top.md',
      'tree:sub',
      'tree:sub/deep',
    ]);
  });

  it('fetchTexts batches 120 paths into 3 GraphQL calls', async () => {
    const calls: { query: string; variables?: Record<string, string> }[] = [];
    handler = async (req) => {
      const body = (await req.json()) as { query: string; variables?: Record<string, string> };
      calls.push(body);
      const data: Record<string, unknown> = {};
      for (const m of body.query.matchAll(/(e\d+): object\(oid/g))
        data[m[1]] = { text: `t-${m[1]}`, isTruncated: false };
      return json({ data });
    };
    const items = Array.from({ length: 120 }, (_, i) => ({ path: `n${i}.md`, sha: `s${i}` }));
    const out = await createClient('tok', ref).fetchTexts(items);
    expect(calls).toHaveLength(3);
    expect(seen.every((r) => r.url === `${API}/graphql`)).toBe(true);
    expect(out.size).toBe(120);
    expect(out.get('n0.md')).toBe('t-e0');
    expect(out.get('n119.md')).toBe('t-e19');
    expect(Object.values(calls[0].variables ?? {})).toContain('s0');
    expect(calls[0].query).toContain('$o0: GitObjectID!');
    expect(calls[0].query).not.toContain('expression');
  });

  it('passes quotes and backslashes in paths safely', async () => {
    let body: { query: string; variables: Record<string, string> } | undefined;
    handler = async (req) => {
      body = (await req.json()) as typeof body;
      return json({ data: { e0: { text: 'x', isTruncated: false } } });
    };
    await createClient('tok', ref).fetchTexts([{ path: 'we"ird\\.md', sha: 'abc123' }]);
    expect(body?.query).not.toContain('we"ird');
    expect(Object.values(body?.variables ?? {})).toEqual(['abc123']);
  });

  it('falls back to REST raw for null or truncated text', async () => {
    handler = async (req) => {
      const u = new URL(req.url);
      if (u.pathname === '/graphql')
        return json({
          data: {
            e0: { text: 'ok', isTruncated: false },
            e1: { text: null, isTruncated: false },
            e2: { text: 'cut', isTruncated: true },
          },
        });
      expect(req.headers.get('accept')).toBe('application/vnd.github.raw');
      return new HttpResponse(`raw:${u.pathname.split('/').pop()}`);
    };
    const out = await createClient('tok', ref).fetchTexts([
      { path: 'a.md', sha: 'sa' },
      { path: 'b.md', sha: 'sb' },
      { path: 'c.md', sha: 'sc' },
    ]);
    expect(out.get('a.md')).toBe('ok');
    expect(out.get('b.md')).toBe('raw:sb');
    expect(out.get('c.md')).toBe('raw:sc');
    expect(seen.map((r) => new URL(r.url).pathname)).toContain('/repos/me/vault/git/blobs/sb');
  });

  it('getRaw fetches the contents API as raw', async () => {
    handler = () => new HttpResponse('hello');
    const b = await createClient('tok', ref).getRaw('img/a b.png');
    expect(b.size).toBe(5);
    expect(seen[0].headers.get('accept')).toBe('application/vnd.github.raw');
    expect(new URL(seen[0].url).pathname).toBe('/repos/me/vault/contents/img/a%20b.png');
    expect(new URL(seen[0].url).searchParams.get('ref')).toBe('main');
  });

  it('putNewFile creates, base64-encodes and never sends sha', async () => {
    let body: Record<string, unknown> = {};
    handler = async (req) => {
      body = (await req.json()) as Record<string, unknown>;
      return json({}, { status: 201 });
    };
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    const r = await createClient('tok', ref).putNewFile('Entrada/a.m4a', new Blob([bytes]), 'msg');
    expect(r).toBe('created');
    expect(seen[0].method).toBe('PUT');
    expect(body.message).toBe('msg');
    expect(body.branch).toBe('main');
    expect('sha' in body).toBe(false);
    const got = Buffer.from(body.content as string, 'base64');
    expect(got.length).toBe(bytes.length);
    expect(got.toString('hex') === Buffer.from(bytes).toString('hex')).toBe(true);
  });

  it('putNewFile returns exists on 422 and never sends sha', async () => {
    let body: Record<string, unknown> = {};
    handler = async (req) => {
      body = (await req.json()) as Record<string, unknown>;
      return json({ message: 'sha wasn\'t supplied' }, { status: 422 });
    };
    const r = await createClient('tok', ref).putNewFile('Entrada/a.md', new Blob(['x']), 'm');
    expect(r).toBe('exists');
    expect('sha' in body).toBe(false);
  });

  it('putNewFile retries 409 then succeeds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let n = 0;
    handler = () => (++n < 3 ? new HttpResponse('{}', { status: 409 }) : json({}, { status: 201 }));
    const p = createClient('tok', ref).putNewFile('Entrada/a.md', new Blob(['x']), 'm');
    expect(await settle(p)).toBe('created');
    expect(n).toBe(3);
  });

  it('putNewFile gives up after 3 retries on 409', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let n = 0;
    handler = () => (n++, new HttpResponse('{}', { status: 409 }));
    const p = kindOf(createClient('tok', ref).putNewFile('Entrada/a.md', new Blob(['x']), 'm'));
    expect((await settle(p)).kind).toBe('Unknown');
    expect(n).toBe(4);
  });

  it('encodes spaces and accents in paths', async () => {
    handler = () => json({}, { status: 201 });
    await createClient('tok', ref).putNewFile('Entrada/Nota de voz ñ é.md', new Blob(['x']), 'm');
    expect(new URL(seen[0].url).pathname).toBe(
      '/repos/me/vault/contents/Entrada/Nota%20de%20voz%20%C3%B1%20%C3%A9.md',
    );
  });

  it('never calls a host other than api.github.com', async () => {
    handler = (req) => {
      const u = new URL(req.url);
      if (u.pathname === '/graphql') return json({ data: { e0: { text: null } } });
      if (u.searchParams.get('recursive')) return json({ sha: 'r', truncated: false, tree: [] });
      return json({}, { status: 201 });
    };
    const c = createClient('tok', ref);
    await c.checkAccess();
    await c.getTree();
    await c.fetchTexts([{ path: 'a.md', sha: 's' }]);
    await c.getRaw('a.md');
    await c.putNewFile('Entrada/a.md', new Blob(['x']), 'm');
    expect(seen.length).toBeGreaterThan(5);
    for (const r of seen) expect(r.url.startsWith('https://api.github.com/')).toBe(true);
  });
});

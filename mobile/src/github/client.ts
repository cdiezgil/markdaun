import { AppError } from './errors';

export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
}

export interface TreeEntry {
  path: string;
  sha: string;
  type: 'blob' | 'tree';
  size?: number;
}

export interface GitHubClient {
  checkAccess(): Promise<void>;
  getTree(): Promise<{ sha: string; entries: TreeEntry[] }>;
  fetchTexts(items: { path: string; sha: string }[]): Promise<Map<string, string>>;
  getRaw(path: string): Promise<Blob>;
  putNewFile(path: string, content: Blob, message: string): Promise<'created' | 'exists'>;
}

const API = 'https://api.github.com';
const RAW = 'application/vnd.github.raw';
const BATCH = 50;
const RETRY_DELAYS = [1000, 2000, 4000];

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function errorFor(res: Response): AppError {
  const status = res.status;
  if (status === 401) return new AppError('Unauthorized', undefined, { status });
  if (status === 403) {
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      return new AppError('RateLimited', undefined, {
        status,
        resetAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : undefined,
      });
    }
    return new AppError('Forbidden', undefined, { status });
  }
  if (status === 404) return new AppError('NotFound', undefined, { status });
  if (status === 413) return new AppError('TooLarge', undefined, { status });
  return new AppError('Unknown', `HTTP ${status}`, { status });
}

// Blob.arrayBuffer is missing in some older WebViews (and jsdom); fall back to FileReader.
function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await readBytes(blob));
  const chunk = 30000; // multiple of 3, so chunks concatenate into valid base64
  let out = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    out += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]));
  }
  return out;
}

interface RawTree {
  sha: string;
  truncated?: boolean;
  tree: { path: string; sha: string; type: string; size?: number }[];
}

export function createClient(
  token: string,
  ref: RepoRef,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): GitHubClient {
  const base = `${API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;

  async function send(url: string, init: RequestInit = {}, accept?: string): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      Accept: accept ?? 'application/vnd.github+json',
      ...((init.headers as Record<string, string>) ?? {}),
    };
    try {
      return await fetchImpl(url, { ...init, headers });
    } catch (e) {
      if (e instanceof TypeError) throw new AppError('Offline', e.message);
      throw e;
    }
  }

  async function ok(url: string, init?: RequestInit, accept?: string): Promise<Response> {
    const res = await send(url, init, accept);
    if (!res.ok) throw errorFor(res);
    return res;
  }

  const branchSeg = encodeURIComponent(ref.branch);

  async function walk(treeSha: string, prefix: string, out: TreeEntry[]): Promise<void> {
    const t = (await (await ok(`${base}/git/trees/${encodeURIComponent(treeSha)}`)).json()) as RawTree;
    for (const e of t.tree) {
      if (e.type !== 'blob' && e.type !== 'tree') continue;
      const path = prefix + e.path;
      out.push({ path, sha: e.sha, type: e.type, size: e.size });
      if (e.type === 'tree') await walk(e.sha, `${path}/`, out);
    }
  }

  async function blobRaw(sha: string): Promise<string> {
    return (await ok(`${base}/git/blobs/${encodeURIComponent(sha)}`, {}, RAW)).text();
  }

  return {
    async checkAccess() {
      await ok(base);
      await ok(`${base}/branches/${branchSeg}`);
    },

    async getTree() {
      const t = (await (
        await ok(`${base}/git/trees/${branchSeg}?recursive=1`)
      ).json()) as RawTree;
      if (!t.truncated) {
        const entries: TreeEntry[] = [];
        for (const e of t.tree) {
          if (e.type === 'blob' || e.type === 'tree')
            entries.push({ path: e.path, sha: e.sha, type: e.type, size: e.size });
        }
        return { sha: t.sha, entries };
      }
      const entries: TreeEntry[] = [];
      const root = (await (await ok(`${base}/git/trees/${branchSeg}`)).json()) as RawTree;
      for (const e of root.tree) {
        if (e.type !== 'blob' && e.type !== 'tree') continue;
        entries.push({ path: e.path, sha: e.sha, type: e.type, size: e.size });
        if (e.type === 'tree') await walk(e.sha, `${e.path}/`, entries);
      }
      return { sha: root.sha, entries };
    },

    async fetchTexts(items) {
      const out = new Map<string, string>();
      for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH);
        const decl = batch.map((_, j) => `$o${j}: GitObjectID!`).join(', ');
        const fields = batch
          .map(
            (_, j) =>
              `e${j}: object(oid: $o${j}) { ... on Blob { text isTruncated } }`,
          )
          .join(' ');
        const variables: Record<string, string> = {};
        batch.forEach((it, j) => {
          variables[`o${j}`] = it.sha;
        });
        const query = `query(${decl}) { repository(owner: ${JSON.stringify(ref.owner)}, name: ${JSON.stringify(ref.repo)}) { ${fields} } }`;
        const res = await ok(`${API}/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables }),
        });
        const body = (await res.json()) as {
          data?: { repository?: Record<string, { text?: string | null; isTruncated?: boolean } | null> } & Record<string, unknown>;
          errors?: unknown;
        };
        // Tolerate both `data.repository.eN` and a flat `data.eN` shape.
        const data = (body.data?.repository ?? body.data ?? {}) as Record<
          string,
          { text?: string | null; isTruncated?: boolean } | null
        >;
        for (let j = 0; j < batch.length; j++) {
          const node = data[`e${j}`];
          if (node && node.text != null && !node.isTruncated) out.set(batch[j].path, node.text);
          else out.set(batch[j].path, await blobRaw(batch[j].sha));
        }
      }
      return out;
    },

    async getRaw(path) {
      const res = await ok(
        `${base}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref.branch)}`,
        {},
        RAW,
      );
      return res.blob();
    },

    async putNewFile(path, content, message) {
      const body = JSON.stringify({
        message,
        content: await toBase64(content),
        branch: ref.branch,
      });
      const url = `${base}/contents/${encodePath(path)}`;
      for (let attempt = 0; ; attempt++) {
        const res = await send(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (res.ok) return 'created';
        if (res.status === 422) return 'exists';
        if (res.status === 409 && attempt < RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt]);
          continue;
        }
        throw errorFor(res);
      }
    },
  };
}

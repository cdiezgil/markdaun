import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(FIX).map((p) => {
  const data = readFileSync(p);
  const sha = createHash('sha1').update(data).digest('hex');
  return { path: relative(FIX, p).split('\\').join('/'), data, sha };
});
const byPath = new Map(files.map((f) => [f.path, f]));

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface Mock {
  puts: string[];
  putMode: { value: 'fail' | 'ok' };
  offline: { value: boolean };
}

async function mockGitHub(page: Page): Promise<Mock> {
  const mock: Mock = { puts: [], putMode: { value: 'ok' }, offline: { value: false } };
  await page.route('https://api.github.com/**', async (route) => {
    if (mock.offline.value) return route.abort('internetdisconnected');
    const req = route.request();
    const url = new URL(req.url());
    const p = decodeURIComponent(url.pathname);
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const reply = (r: Parameters<Route['fulfill']>[0]) =>
      route.fulfill({ ...r, headers: { ...cors, ...(r.headers ?? {}) } });

    if (p === '/graphql') {
      const { variables } = req.postDataJSON() as { variables: Record<string, string> };
      const repository: Record<string, unknown> = {};
      Object.entries(variables).forEach(([k, oid]) => {
        const f = files.find((x) => x.sha === oid);
        repository[`e${k.slice(1)}`] = f ? { text: f.data.toString('utf8'), isTruncated: false } : null;
      });
      return reply({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { repository } }) });
    }
    if (/^\/repos\/[^/]+\/[^/]+$/.test(p)) return reply({ status: 200, contentType: 'application/json', body: '{"id":1}' });
    if (/\/branches\/main$/.test(p)) return reply({ status: 200, contentType: 'application/json', body: '{"name":"main"}' });
    if (/\/git\/trees\/main$/.test(p)) {
      return reply({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sha: 'treesha-1',
          truncated: false,
          tree: files.map((f) => ({ path: f.path, sha: f.sha, type: 'blob', size: f.data.length })),
        }),
      });
    }
    const contents = /\/contents\/(.+)$/.exec(p);
    if (contents && req.method() === 'GET') {
      const f = byPath.get(contents[1]);
      return f
        ? reply({ status: 200, contentType: 'image/jpeg', body: f.data })
        : reply({ status: 404, contentType: 'application/json', body: '{}' });
    }
    if (contents && req.method() === 'PUT') {
      if (mock.putMode.value === 'fail') return route.abort('internetdisconnected');
      mock.puts.push(contents[1]);
      return reply({ status: 201, contentType: 'application/json', body: '{"content":{}}' });
    }
    return reply({ status: 404, contentType: 'application/json', body: '{}' });
  });
  return mock;
}

// Chromium's fake audio device blocks the renderer on macOS (getUserMedia({audio}) never returns there, while it
// works on Linux CI). On macOS only, substitute a WebAudio tone stream so the real MediaRecorder path still runs.
async function ensureMicrophone(page: Page): Promise<void> {
  await page.addInitScript((useStub: boolean) => {
    if (!useStub) return;
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return dest.stream;
    };
  }, process.platform === 'darwin');
}

test('connect, search, read, dictate offline, upload when back', async ({ page }) => {
  await ensureMicrophone(page);
  const mock = await mockGitHub(page);

  // Setup -> home
  await page.goto('/markdaun/#/');
  await expect(page.getByRole('heading', { name: 'Conecta tu repositorio' })).toBeVisible();
  await page.getByLabel('Repositorio (usuario/nombre)').fill('acme/vault');
  await page.getByLabel('Rama').fill('main');
  await page.getByLabel('Token de GitHub').fill('github_pat_test');
  await page.getByRole('button', { name: 'Conectar' }).click();
  await expect(page.getByPlaceholder('Buscar en tus notas')).toBeVisible();

  // Search -> open note -> image -> wikilink -> back
  await page.getByPlaceholder('Buscar en tus notas').fill('limon');
  await page.getByRole('link', { name: /Tarta de limon/ }).first().click();
  const img = page.locator('article.note img');
  await expect(img).toBeVisible();
  await expect
    .poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0))
    .toBe(true);
  await page.locator('article.note a[data-note]', { hasText: 'Receta base' }).click();
  // Duplicate names: the one in the same folder (Cocina) wins.
  await expect(page.locator('article.note')).toContainText('Masa de la cocina');
  await page.goBack();
  await expect(page.locator('article.note')).toContainText('tarta fresca');
  await page.goBack();

  // Offline for GitHub: reload still shows the notes from IndexedDB.
  mock.offline.value = true;
  await page.reload();
  await page.getByPlaceholder('Buscar en tus notas').fill('limon');
  await expect(page.getByRole('link', { name: /Tarta de limon/ }).first()).toBeVisible();
  await page.getByPlaceholder('Buscar en tus notas').fill('');

  // Dictate while uploads fail: stays pending
  mock.putMode.value = 'fail';
  await page.getByRole('button', { name: 'Dictar nota' }).click();
  await expect(page.getByRole('button', { name: 'Detener' })).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Detener' }).click();
  await expect(page.getByText('1 nota pendiente de subir')).toBeVisible();
  expect(mock.puts).toHaveLength(0);

  // Network back: exactly one PUT, pending disappears
  mock.offline.value = false;
  mock.putMode.value = 'ok';
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/nota(s)? pendiente(s)? de subir/)).toHaveCount(0);
  expect(mock.puts).toHaveLength(1);
  expect(mock.puts[0]).toMatch(/^Entrada\/Nota de voz \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.webm$/);

  // Mermaid note renders a diagram
  await page.goto('/markdaun/#/note/Ideas%2FDiagrama.md');
  await expect(page.locator('article.note svg').first()).toBeVisible({ timeout: 15_000 });
});

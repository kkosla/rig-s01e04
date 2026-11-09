import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerDigestPage } from '../src/digest/page-route.js';

const night = '2026-10-28';
const event = {
  at: '2026-10-29T01:00:00+01:00', job: 'job', status: 'ok', owner: 'rook',
};

describe('digest page registration', () => {
  let runsDir: string;
  let app: Hono;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-page-test-'));
    vi.stubEnv('LANE_ID', 'test-lane');
    vi.stubEnv('LANE_MARKER', 'TEST-MARKER');
    app = new Hono();
    registerDigestPage(app, {
      adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeEvents(events: unknown[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), events.map((value) => JSON.stringify(value)).join('\n'));
  }

  it('renders sorted jobs, all fields, source offsets and the standard lane layout', async () => {
    writeEvents([
      { ...event, job: 'z-last', owner: null },
      { ...event, job: 'a-first', status: 'retry', error: 'upstream 503' },
      { ...event, job: 'a-first', at: '2026-10-29T02:30:00+02:00' },
    ]);
    const res = await app.request(`/digest/${night}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('test-lane');
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('<style>');
    expect(html).not.toContain('<script');
    expect(html.indexOf('<td>a-first</td>')).toBeLessThan(html.indexOf('<td>z-last</td>'));
    for (const heading of ['job', 'owner', 'runs', 'retries', 'last status', 'last error', 'first time', 'last time']) {
      expect(html).toContain(`<th scope="col">${heading}</th>`);
    }
    expect(html).toContain('<td>rook</td><td>2</td><td>1</td><td>ok</td><td>upstream 503</td>');
    expect(html).toContain('<td>2026-10-29T01:00:00+01:00</td><td>2026-10-29T02:30:00+02:00</td>');
    expect(html).toContain('<td>z-last</td><td>—</td><td>1</td><td>0</td><td>ok</td><td>—</td>');
  });

  it('marks three retries and historical failures with visible warning labels', async () => {
    writeEvents([
      { ...event, job: 'retried', status: 'retry' },
      { ...event, job: 'retried', status: 'retry' },
      { ...event, job: 'retried', status: 'retry' },
      { ...event, job: 'recovered', status: 'fail', error: 'failed once' },
      { ...event, job: 'recovered' },
    ]);
    const html = await (await app.request(`/digest/${night}`)).text();
    expect(html).toContain('<td class="warn">3 · repeated retries</td>');
    expect(html).toContain('<td class="warn">ok · failure occurred</td>');
    expect(html).toContain('Warnings: 3 or more retries; any failure, even if the last status is ok.');
  });

  it('returns 404 for missing and invalid night names', async () => {
    for (const name of [night, 'not-a-night', '2026-1-01', '2026-10-28.jsonl', '..%2F2026-10-28']) {
      expect((await app.request(`/digest/${name}`)).status).toBe(404);
    }
  });

  it('renders an empty night with nothing ran', async () => {
    writeEvents([]);
    const res = await app.request(`/digest/${night}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('nothing ran');
    expect(html).toContain('bad lines: 0');
    expect(html).not.toContain('<table>');
  });

  it('shows bad-line counts without dropping valid rows', async () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), `{broken\nnull\n${JSON.stringify(event)}\n`);
    const res = await app.request(`/digest/${night}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<p class="warn">bad lines: 2</p>');
    expect(html).toContain('<td>job</td>');
  });

  it('escapes log content and renders empty owner/error values as missing', async () => {
    writeEvents([{ ...event, job: '<script>alert(1)</script>', owner: '', error: '' }]);
    const html = await (await app.request(`/digest/${night}`)).text();
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<td>—</td><td>1</td><td>0</td><td>ok</td><td>—</td>');
  });
});

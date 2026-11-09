import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readStatus } from '../src/status.js';

describe('digest links on the status board', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-board-test-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function config() {
    return { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };
  }

  it('links every night newest first with event counts, not final job statuses', async () => {
    const event = { at: '2026-10-29T01:00:00+01:00', job: 'recovered', owner: null };
    const events = ['retry', 'retry', 'fail', 'ok', 'ok'].map((status) => ({ ...event, status }));
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), [
      ...events.map((value) => JSON.stringify(value)),
      '{broken',
      JSON.stringify({ ...event, status: 'unknown' }),
    ].join('\n'));
    writeFileSync(join(runsDir, '2026-10-27.jsonl'), JSON.stringify({ ...event, status: 'fail' }));
    writeFileSync(join(runsDir, '2026-10-29.jsonl'), '');
    writeFileSync(join(runsDir, 'notes.txt'), 'not a night');

    const status = readStatus(config());
    expect(status.nights).toEqual(['2026-10-29', '2026-10-28', '2026-10-27']);
    expect(status.summaries).toEqual({
      '2026-10-29': { ok: 0, retry: 0, fail: 0 },
      '2026-10-28': { ok: 2, retry: 2, fail: 1 },
      '2026-10-27': { ok: 0, retry: 0, fail: 1 },
    });

    const response = await createApp(config()).request('/');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html.match(/href="\/digest\/[^\"]+"/g)).toEqual([
      'href="/digest/2026-10-29"',
      'href="/digest/2026-10-28"',
      'href="/digest/2026-10-27"',
    ]);
    expect(html).toContain('<a href="/digest/2026-10-29">2026-10-29</a> · ok 0 / retry 0 / fail 0');
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a> · ok 2 / retry 2 / fail 1');
    expect(html).toContain('<a href="/digest/2026-10-27">2026-10-27</a> · ok 0 / retry 0 / fail 1');
    expect(html).toContain('shim');
    expect(html).toContain('2026-10-29T14:06:00+01:00');
    expect(html).toContain('last beat');
    expect(html).not.toContain('<script');
  });

  it('keeps the empty-board message when no nights exist', async () => {
    const response = await createApp(config()).request('/');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('nothing in runs/');
    expect(html).not.toContain('href="/digest/');
  });

  it('keeps the empty-board message when the runs directory is missing', async () => {
    const missing = { ...config(), runsDir: join(runsDir, 'missing') };
    expect(readStatus(missing)).toMatchObject({ nights: [], summaries: {} });
    const response = await createApp(missing).request('/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('nothing in runs/');
  });
});

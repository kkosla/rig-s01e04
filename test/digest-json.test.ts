import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerDigestJson } from '../src/digest/json-route.js';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const event = {
  at: '2026-10-29T01:00:00+01:00', job: 'z-job', status: 'retry', owner: null,
};

describe('digest JSON route', () => {
  let runsDir: string;
  let app: Hono;

  beforeEach(() => {
    runsDir = mkdtempSync('/tmp/opencode/rig-json-test-');
    app = new Hono();
    registerDigestJson(app, {
      adapter: 'shim', installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60, runsDir,
    });
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('returns the exact shared reader result, including sorted rows and counts', async () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), [
      event, { ...event, job: 'a-job', status: 'fail', error: 'failed' },
      { ...event, at: '2026-10-29T01:01:00+01:00', status: 'ok' },
    ].map((value) => JSON.stringify(value)).join('\n'));

    const res = await app.request(`/api/digest/${night}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json();
    expect(body).toEqual(readNight(runsDir, night));
    expect(body).toMatchObject({
      night, badLines: 0, counts: { ok: 1, retry: 1, fail: 1 },
      rows: [{ job: 'a-job' }, { job: 'z-job', owner: null }],
    });
  });

  it('returns JSON 404 for missing or invalid night names', async () => {
    for (const name of [night, 'not-a-night', '2026-1-01', '..%2F2026-10-28']) {
      const res = await app.request(`/api/digest/${name}`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({ error: 'Night not found' });
    }
  });

  it('returns an empty digest with 200 for an existing empty file', async () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), '');
    const res = await app.request(`/api/digest/${night}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps malformed nights readable with the reader bad-line count', async () => {
    for (const source of ['{broken\nnull', `{broken\nnull\n${JSON.stringify(event)}`]) {
      writeFileSync(join(runsDir, `${night}.jsonl`), source);
      const res = await app.request(`/api/digest/${night}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual(readNight(runsDir, night));
      expect(body).toMatchObject({ badLines: 2 });
    }
  });
});

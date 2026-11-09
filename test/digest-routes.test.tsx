import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { JobStatus, NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const at = (hour: number) => `${night}T${String(hour).padStart(2, '0')}:00:00+01:00`;
const event = (job: string, status: JobStatus, hour: number, owner: string | null = 'rook', error?: string) =>
  JSON.stringify({ at: at(hour), job, status, owner, ...(error === undefined ? {} : { error }) });

// Inspect the actual server-rendered table without adding a browser or client JS.
function tableRows(html: string): string[] {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map(([row]) => row)
    .filter((row) => /<td\b/i.test(row));
}

function firstCell(row: string): string {
  const cell = row.match(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/i);
  expect(cell, 'each data row has a job cell').not.toBeNull();
  return cell![1].replace(/<[^>]*>/g, '').trim();
}

describe('digest routes', () => {
  let runsDir: string;
  let config: RigConfig;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    config = { adapter: 'shim', installed: at(0), beatEverySeconds: 60, runsDir };
    vi.stubEnv('LANE_ID', 'digest-test-lane');
    vi.stubEnv('LANE_MARKER', 'DIGEST-TEST-MARKER');
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  function writeNight(lines: string[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.join('\n'));
  }

  function populatedNight(): NightDigest {
    // Deliberately not job-sorted; a past failure still warns after recovery.
    writeNight([
      event('zulu', 'ok', 8, null),
      event('charlie', 'fail', 1, 'rook', 'connection lost'),
      event('bravo', 'retry', 1),
      event('alpha', 'retry', 1),
      event('bravo', 'retry', 2),
      event('alpha', 'retry', 2),
      event('bravo', 'retry', 3),
      event('alpha', 'ok', 4),
      event('charlie', 'ok', 5),
    ]);
    return {
      night,
      rows: [
        { job: 'alpha', owner: 'rook', runs: 3, retries: 2, lastStatus: 'ok', lastError: null, firstAt: at(1), lastAt: at(4), hasFail: false },
        { job: 'bravo', owner: 'rook', runs: 3, retries: 3, lastStatus: 'retry', lastError: null, firstAt: at(1), lastAt: at(3), hasFail: false },
        { job: 'charlie', owner: 'rook', runs: 2, retries: 0, lastStatus: 'ok', lastError: 'connection lost', firstAt: at(1), lastAt: at(5), hasFail: true },
        { job: 'zulu', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: at(8), lastAt: at(8), hasFail: false },
      ],
      badLines: 0,
      counts: { ok: 3, retry: 5, fail: 1 },
    };
  }

  it('serves a complete JSON digest and the same ordered jobs in the lane layout', async () => {
    const expected = populatedNight();
    const app = createApp(config);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    const htmlResponse = await app.request(`/digest/${night}`);

    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    const digest: NightDigest = await jsonResponse.json();
    expect(digest).toEqual(expected);

    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    const html = await htmlResponse.text();
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('<header>');
    expect(html).toContain('digest-test-lane');
    expect(html).toContain('DIGEST-TEST-MARKER');
    expect(html).toContain('<style>');
    expect(html).toContain(night);
    expect(html.match(/<table\b/g)).toHaveLength(1);
    expect(tableRows(html).map(firstCell)).toEqual(digest.rows.map((row) => row.job));
    expect(html).toContain(at(1));
    expect(html).toContain(at(8));
    expect(html).not.toMatch(/<script\b/i);
  });

  it('marks three retries and historical failures, but not two retries or a clean job', async () => {
    populatedNight();
    const response = await createApp(config).request(`/digest/${night}`);
    expect(response.status).toBe(200);
    const rows = tableRows(await response.text());
    expect(rows.map(firstCell)).toEqual(['alpha', 'bravo', 'charlie', 'zulu']);
    const warns = /class=["'][^"']*\bwarn\b[^"']*["']/;
    expect(rows[0]).not.toMatch(warns);
    expect(rows[1]).toMatch(warns);
    expect(rows[2]).toMatch(warns);
    expect(rows[2]).toContain('connection lost');
    expect(rows[3]).not.toMatch(warns);
  });

  it('retains a null-owner job in JSON and renders its owner as an em dash', async () => {
    writeNight([event('unowned', 'ok', 1, null)]);
    const app = createApp(config);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    const digest: NightDigest = await jsonResponse.json();
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0]).toMatchObject({ job: 'unowned', owner: null });

    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const rows = tableRows(await htmlResponse.text());
    expect(rows.map(firstCell)).toEqual(['unowned']);
    expect(rows[0]).toMatch(/<td\b[^>]*>\s*(?:<[^>]+>\s*)*—\s*(?:<\/[^>]+>\s*)*<\/td>/);
  });

  it.each(['/digest', '/api/digest'])('%s returns 404 for a missing night', async (route) => {
    const response = await createApp(config).request(`${route}/2026-10-27`);
    expect(response.status).toBe(404);
  });

  it.each(['/digest', '/api/digest'])('%s rejects invalid night names even if a matching file exists', async (route) => {
    writeFileSync(join(runsDir, 'not-a-night.jsonl'), event('must-not-read', 'ok', 1));
    const response = await createApp(config).request(`${route}/not-a-night`);
    expect(response.status).toBe(404);
  });

  it('serves an empty file as an empty digest and says nothing ran', async () => {
    writeNight([]);
    const app = createApp(config);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({ night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });

    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).toContain('nothing ran');
    expect(tableRows(html)).toEqual([]);
  });

  it('counts malformed JSON and invalid schema lines without losing valid rows', async () => {
    writeNight([
      event('survivor', 'ok', 1, null),
      '{broken json',
      JSON.stringify({ at: at(2), job: 'invalid-status', status: 'unknown', owner: 'rook' }),
      '',
      '   ',
    ]);
    const app = createApp(config);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      night,
      rows: [{ job: 'survivor', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt: at(1), lastAt: at(1), hasFail: false }],
      badLines: 2,
      counts: { ok: 1, retry: 0, fail: 0 },
    });
    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(tableRows(await htmlResponse.text()).map(firstCell)).toEqual(['survivor']);
  });

  it('escapes logged values in HTML while preserving their exact JSON values', async () => {
    const job = '<script>alert("job")</script>';
    const owner = '<img src=x onerror="alert(1)">';
    const error = '<script>alert("error")</script> & unavailable';
    writeNight([event(job, 'fail', 1, owner, error)]);
    const app = createApp(config);
    const jsonResponse = await app.request(`/api/digest/${night}`);
    expect(jsonResponse.status).toBe(200);
    const digest: NightDigest = await jsonResponse.json();
    expect(digest.rows[0]).toMatchObject({ job, owner, lastError: error });

    const htmlResponse = await app.request(`/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(tableRows(html)).toHaveLength(1);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&amp; unavailable');
    expect(html).not.toContain(job);
    expect(html).not.toContain(owner);
    expect(html).not.toContain(error);
    expect(html).not.toMatch(/<(?:script|img)\b/i);
  });
});

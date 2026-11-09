import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const event = {
  at: '2026-10-29T01:00:00+01:00', job: 'job', status: 'ok', owner: 'rook',
};

describe('night reader', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync('/tmp/opencode/rig-reader-test-');
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeEvents(events: unknown[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), events.map((value) => JSON.stringify(value)).join('\n'));
  }

  it('reads the real night: five sorted jobs and one bad line', () => {
    const digest = readNight('runs', night);
    expect(digest).not.toBeNull();
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows[0].owner).toBeNull();
    expect(digest?.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503', hasFail: false,
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(digest?.rows[2].runs).toBe(8);
    expect(digest?.rows[3].hasFail).toBe(true);
  });

  it('distinguishes missing files from empty nights and ignores blank lines', () => {
    expect(readNight(runsDir, night)).toBeNull();
    for (const source of ['', '  \n\r\n\t\n']) {
      writeFileSync(join(runsDir, `${night}.jsonl`), source);
      expect(readNight(runsDir, night)).toEqual({
        night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
      });
    }
  });

  it('aggregates by instant, retains offsets, latest owner and historical failures/errors', () => {
    writeEvents([
      { ...event, at: '2026-10-29T02:30:00+02:00', status: 'fail', error: 'new error' },
      { ...event, at: '2026-10-29T01:00:00Z', owner: null },
      { ...event, at: '2026-10-29T01:15:00+01:00', status: 'retry', error: 'older error' },
      { ...event, at: '2026-10-28T23:00:00Z', status: 'retry', owner: 'first owner' },
    ]);
    expect(readNight(runsDir, night)).toEqual({
      night, badLines: 0, counts: { ok: 1, retry: 2, fail: 1 },
      rows: [{
        job: 'job', owner: null, runs: 4, retries: 2, lastStatus: 'ok',
        lastError: 'new error', hasFail: true,
        firstAt: '2026-10-28T23:00:00Z', lastAt: '2026-10-29T01:00:00Z',
      }],
    });
  });

  it('uses the later line for tied latest events and errors, including empty errors', () => {
    writeEvents([
      { ...event, status: 'retry', error: 'first' },
      { ...event, status: 'fail', owner: null, error: '' },
    ]);
    expect(readNight(runsDir, night)?.rows[0]).toMatchObject({
      owner: null, lastStatus: 'fail', lastError: '', runs: 2, retries: 1, hasFail: true,
    });
  });

  it('counts invalid JSON and schema without losing valid rows', () => {
    const invalid = [
      null, [], 42, 'text', {},
      { ...event, at: 'not a timestamp' },
      { ...event, at: '2026-02-30T01:00:00Z' },
      { ...event, at: '2026-10-29T01:00:00' },
      { ...event, job: '' }, { ...event, job: 42 },
      { ...event, status: 'unknown' },
      { ...event, owner: undefined }, { ...event, owner: 42 },
      { ...event, error: null }, { ...event, error: 42 },
    ];
    writeFileSync(join(runsDir, `${night}.jsonl`),
      `${invalid.map((value) => JSON.stringify(value)).join('\r\n')}\r\n{broken\r\n${JSON.stringify(event)}\r\n${JSON.stringify({ ...event, job: '__proto__', owner: null })}\r\n`);
    const digest = readNight(runsDir, night);
    expect(digest?.badLines).toBe(invalid.length + 1);
    expect(digest?.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
    expect(digest?.rows.map((row) => row.job)).toEqual(['__proto__', 'job']);
  });

  it('returns an empty digest with a bad-line count when every line is malformed', () => {
    writeEvents([null, { ...event, status: 'pending' }]);
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 2, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('rejects traversal and non-date night names before reading', () => {
    for (const name of ['../2026-10-28', '/2026-10-28', '2026-1-01', '2026-10-28.jsonl', '2026-10-28\n']) {
      expect(readNight(runsDir, name)).toBeNull();
    }
  });

  it('propagates filesystem errors other than missing files', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
  });
});

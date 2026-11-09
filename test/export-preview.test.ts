import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const script = new URL('../scripts/export-preview.mjs', import.meta.url).pathname;
const sample = '<!doctype html><html><body>sample digest</body></html>';

describe('preview export', () => {
  let directory: string;
  let server: Server;
  let port: string;
  let status: number;
  let contentType: string;
  let body: string;
  let requested: string | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'rig-export-test-'));
    status = 200;
    contentType = 'text/html; charset=UTF-8';
    body = sample;
    requested = undefined;
    server = createServer((request, response) => {
      requested = request.url;
      response.writeHead(status, { 'content-type': contentType, location: '/elsewhere' });
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    port = String(address.port);
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  function run(...args: string[]) {
    return exec(process.execPath, [script, ...args], { env: { ...process.env, PORT: port } });
  }

  it('exports the running route exactly, privately, replacing an old file', async () => {
    const output = join(directory, 'digest.html');
    await writeFile(output, 'old export');
    const result = await run(output);
    expect(requested).toBe('/digest/2026-10-28');
    expect(await readFile(output, 'utf8')).toBe(sample);
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(['digest.html']);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it.each([
    [404, 'text/html', 'missing'],
    [500, 'text/html', 'failure'],
    [200, 'application/json', '{}'],
    [200, 'text/html', ''],
    [302, 'text/html', 'redirect'],
  ])('preserves an old export for status %s, type %s, body %s', async (code, type, html) => {
    status = code;
    contentType = type;
    body = html;
    const output = join(directory, 'digest.html');
    await writeFile(output, 'old export');
    await expect(run(output)).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe('old export');
    expect(await readdir(directory)).toEqual(['digest.html']);
  });

  it('requires exactly one absolute output path', async () => {
    await expect(run()).rejects.toThrow('Usage:');
    await expect(run('digest.html')).rejects.toThrow('Usage:');
    await expect(run(join(directory, 'digest.html'), 'extra')).rejects.toThrow('Usage:');
    expect(requested).toBeUndefined();
  });

  it('rejects an output in the checkout, also through a symlinked parent', async () => {
    const repo = new URL('../', import.meta.url).pathname;
    await expect(run(join(repo, 'must-not-create.html'))).rejects.toThrow('outside this repository');
    await symlink(repo, join(directory, 'checkout'));
    await expect(run(join(directory, 'checkout', 'must-not-create.html'))).rejects.toThrow('outside this repository');
    expect(requested).toBeUndefined();
  });
});

import { mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Fetch the running renderer, never reconstruct the page or load its environment.
async function main() {
  const [output, ...extra] = process.argv.slice(2);
  if (!output || extra.length || !isAbsolute(output)) {
    throw new Error('Usage: pnpm export-preview /absolute/path/outside-repo/digest.html');
  }

  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  // Resolve the parent to catch symlinks into this checkout. It must already exist.
  const requested = resolve(output);
  const parent = await realpath(dirname(requested));
  const destination = join(parent, basename(requested));
  const repo = await realpath(fileURLToPath(new URL('../', import.meta.url)));
  const pathFromRepo = relative(repo, destination);
  if (!isAbsolute(pathFromRepo) && pathFromRepo !== '..' && !pathFromRepo.startsWith(`..${sep}`)) {
    throw new Error('Preview output must be outside this repository checkout');
  }

  const response = await fetch(`http://127.0.0.1:${port}/digest/2026-10-28`, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status !== 200 || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error(`Expected HTTP 200 HTML; received HTTP ${response.status}`);
  }
  const html = await response.text();
  if (!html.trim()) throw new Error('Refusing to export an empty page');

  // A failed fetch/write never truncates an existing export. Keep staging private.
  const staging = await mkdtemp(join(parent, '.rig-preview-'));
  try {
    const temporary = join(staging, 'digest.html');
    await writeFile(temporary, html, { mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

main().catch((error) => {
  // Do not log response bodies: a rendered page can contain the lane marker.
  console.error(`Export failed: ${error.message}`);
  process.exitCode = 1;
});

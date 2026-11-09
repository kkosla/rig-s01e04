# Export a digest for review

Use only the supplied sample run data, not a real user's logs. The export fetches the
**running service**, including its current banner, inline stylesheet and server-rendered
digest. It does not read `.env`, print the HTML, publish anything or start the service.
Never commit an export or put one in an issue or chat attachment (ADR 0003).

## Private export

With dependencies installed and `.env` configured locally, start rig from the checkout:

```sh
pnpm start
```

The server binds only to `127.0.0.1:8787`. `pnpm start` loads `.env`, including the lane
marker; do not copy or print the marker. Leave the server running. In another terminal,
from the same checkout:

```sh
umask 077
mkdir -p /tmp/opencode/rig-s01e04-private
pnpm export-preview /tmp/opencode/rig-s01e04-private/digest-review.html
```

An absolute output path is required; its parent must exist and must be outside the
checkout (including symlinked parents). Keep it outside **every** Git checkout. The
command fetches only `/digest/2026-10-28` on loopback, rejects redirects, HTTP errors,
non-HTML and empty responses, and leaves any existing export intact on failure. An
export is replaced atomically and is readable only by its owner. If using another port,
set the same `PORT` for both commands. Review the file privately before publication.

## Publish only with human approval

Get explicit approval for the host, public HTTPS URL, banner exposure, upload and later
replacement. Anyone with that URL can read the file. Choose a host where the same URL
can be overwritten; serve a dedicated public directory outside Git, never the checkout
or the private export directory. Do not expose the running rig service.

Only after that approval and private review, an already-configured static host could
use the following replacement in its dedicated document root:

```sh
install -m 0644 /tmp/opencode/rig-s01e04-private/digest-review.html /tmp/opencode/rig-s01e04-public/.digest-next.html
mv -f /tmp/opencode/rig-s01e04-public/.digest-next.html /tmp/opencode/rig-s01e04-public/digest.html
```

The public root must already exist and belong only to this preview. Stage and rename on
the same filesystem so readers never receive a partial file. For a remote static host,
use its equivalent overwrite operation, not a new URL. Verify the actual HTTPS response
and caching behavior, then send the reviewer the link and the plan's issues. **Issue #6
remains open until that link has actually been sent**, not merely exported locally.

## Remove the marker after review

After review, stop the original server (Ctrl-C) before restarting it:

```sh
LANE_MARKER='' pnpm start
```

An explicitly empty environment value wins over Node's `.env` loading. Merely unsetting
the variable would let `.env` restore the marker. In the other terminal:

```sh
pnpm export-preview /tmp/opencode/rig-s01e04-private/digest-clean.html
```

Privately verify that the banner says `no marker set`, and review the entire file for
unwanted lane data. With human approval for replacement, stage this clean file in the
same public root and atomically rename it over `digest.html` as above. Verify the same
public HTTPS URL now serves the clean page (invalidate caches if needed). Never publish
the private directory. Replacing the public page removes the live marker, but cannot
recall copies someone already downloaded.

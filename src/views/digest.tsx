import type { NightDigest } from '../digest/types.js';

export function DigestPage({ digest }: { digest: NightDigest }) {
  return (
    <>
      <h1>digest · {digest.night}</h1>
      <p class={digest.badLines > 0 ? 'warn' : 'mute'}>bad lines: {digest.badLines}</p>
      {digest.rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <caption>Warnings: 3 or more retries; any failure, even if the last status is ok.</caption>
          <thead>
            <tr>
              <th scope="col">job</th>
              <th scope="col">owner</th>
              <th scope="col">runs</th>
              <th scope="col">retries</th>
              <th scope="col">last status</th>
              <th scope="col">last error</th>
              <th scope="col">first time</th>
              <th scope="col">last time</th>
            </tr>
          </thead>
          <tbody>
            {digest.rows.map((row) => (
              <tr>
                <td>{row.job}</td>
                <td>{row.owner || '—'}</td>
                <td>{row.runs}</td>
                <td class={row.retries >= 3 ? 'warn' : undefined}>
                  {row.retries}{row.retries >= 3 ? ' · repeated retries' : ''}
                </td>
                <td class={row.hasFail ? 'warn' : undefined}>
                  {row.lastStatus}{row.hasFail ? ' · failure occurred' : ''}
                </td>
                <td>{row.lastError || '—'}</td>
                <td>{row.firstAt}</td>
                <td>{row.lastAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

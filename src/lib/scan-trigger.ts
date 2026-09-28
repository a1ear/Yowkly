import 'server-only';
import { serverEnv } from '@/lib/env.server';

/**
 * Start the "Scan uploads" GitHub workflow now instead of waiting for its
 * hourly schedule, so a new upload is scanned in about 2 minutes. Best effort:
 * if GitHub is down or the token is missing, the scheduled run still picks the
 * file up. The workflow's concurrency group stops runs piling up.
 */
export async function triggerScan() {
  const token = serverEnv.GITHUB_SCAN_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`https://api.github.com/repos/${serverEnv.GITHUB_SCAN_REPO}/actions/workflows/scan.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'yowkly-scan-trigger',
      },
      body: JSON.stringify({ ref: serverEnv.GITHUB_SCAN_REF }),
      signal: AbortSignal.timeout(5000),
    });
    // 204 = started. 401/403 = bad token or missing Actions permission; 404 = wrong repo or workflow name.
    if (res.status !== 204) console.error('[scan] could not start the scan workflow:', res.status, (await res.text()).slice(0, 200));
  } catch (e) {
    console.error('[scan] could not start the scan workflow:', (e as Error).message);
  }
}

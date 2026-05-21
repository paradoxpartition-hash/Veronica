import { execSync } from 'child_process';

// Prometheus is intentionally not exposed publicly.
// Only internal Docker network checks are valid.

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 10000 }).trim();
  } catch (err: any) {
    return (err.stderr || err.message || 'command failed').trim();
  }
}

function isPrometheusResponse(body: string): boolean {
  return (
    body.toLowerCase().includes('prometheus is healthy') ||
    body.toLowerCase().includes('prometheus is ready')
  );
}

export async function checkPrometheusHealth(): Promise<boolean> {
  const internalHost = process.env.PROMETHEUS_HOST || 'prometheus';

  // Internal Docker network only — public access is disabled by design.
  const urls = [
    `http://${internalHost}:9090/-/healthy`,
    'http://127.0.0.1:9090/-/healthy',
  ];

  for (const url of urls) {
    if (isPrometheusResponse(exec(`curl -s --max-time 5 "${url}"`))) return true;
  }
  return false;
}

export function getPrometheusLogs(lines = 120): string {
  return exec(`docker logs --tail ${lines} prometheus 2>&1`);
}

export function restartPrometheus(): string {
  return exec('docker restart prometheus');
}

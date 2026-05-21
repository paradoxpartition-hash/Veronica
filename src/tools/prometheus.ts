import { execSync } from 'child_process';

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 10000 }).trim();
  } catch (err: any) {
    return (err.stderr || err.message || 'command failed').trim();
  }
}

const HOST = process.env.PROMETHEUS_HOST || 'prometheus';

export async function checkPrometheusHealth(): Promise<boolean> {
  const urls = [
    `http://${HOST}:9090/-/healthy`,
    'http://127.0.0.1:9090/-/healthy',
  ];

  for (const url of urls) {
    const result = exec(`curl -s --max-time 5 "${url}"`);
    if (
      result.toLowerCase().includes('prometheus is healthy') ||
      result.toLowerCase().includes('prometheus is ready')
    ) {
      return true;
    }
  }
  return false;
}

export function getPrometheusLogs(lines = 120): string {
  return exec(`docker logs --tail ${lines} prometheus 2>&1`);
}

export function restartPrometheus(): string {
  return exec('docker restart prometheus');
}

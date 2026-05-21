import { execSync } from 'child_process';

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 10000 }).trim();
  } catch (err: any) {
    return (err.stderr || err.message || 'command failed').trim();
  }
}

const HOST = process.env.GRAFANA_HOST || 'grafana';

export async function checkGrafanaHealth(): Promise<boolean> {
  const urls = [
    `http://${HOST}:3000/api/health`,
    'http://127.0.0.1:3000/api/health',
  ];

  for (const url of urls) {
    const result = exec(`curl -s --max-time 5 "${url}"`);
    if (result.includes('"ok"') || result.toLowerCase().includes('database: ok')) {
      return true;
    }
  }
  return false;
}

export function getGrafanaLogs(lines = 80): string {
  return exec(`docker logs --tail ${lines} grafana 2>&1`);
}

export function restartGrafana(): string {
  return exec('docker restart grafana');
}

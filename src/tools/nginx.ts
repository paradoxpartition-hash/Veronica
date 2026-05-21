import { execSync } from 'child_process';

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 10000 }).trim();
  } catch (err: any) {
    return (err.stderr || err.message || 'command failed').trim();
  }
}

const HOST = process.env.NPM_HOST || 'nginx-proxy-manager';

export async function checkNginxHealth(): Promise<boolean> {
  const urls = [
    `http://${HOST}:81`,
    'http://127.0.0.1:81',
  ];

  for (const url of urls) {
    const code = exec(`curl -s --max-time 5 -o /dev/null -w "%{http_code}" "${url}"`);
    if (['200', '301', '302', '401', '403'].includes(code.trim())) {
      return true;
    }
  }
  return false;
}

export function getNginxLogs(lines = 80): string {
  return exec(`docker logs --tail ${lines} nginx-proxy-manager 2>&1`);
}

export function restartNginx(): string {
  return exec('docker restart nginx-proxy-manager');
}

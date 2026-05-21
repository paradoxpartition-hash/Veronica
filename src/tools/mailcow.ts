import { execSync } from 'child_process';

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 10000 }).trim();
  } catch (err: any) {
    return (err.stderr || err.message || 'command failed').trim();
  }
}

export function checkMailcowHealth(): string {
  const result = exec(
    `docker ps --format "{{.Names}} | {{.Status}}" 2>/dev/null | grep -i mailcow`
  );
  return result || 'No Mailcow containers found.';
}

export function getMailcowWatchdogLogs(lines = 120): string {
  return exec(`docker logs --tail ${lines} mailcowdockerized-watchdog-mailcow-1 2>&1`);
}

export function getMailcowPostfixLogs(lines = 80): string {
  return exec(`docker logs --tail ${lines} mailcowdockerized-postfix-mailcow-1 2>&1`);
}

export function isMailcowHealthy(): boolean {
  const status = checkMailcowHealth();
  const lines = status.split('\n');
  const unhealthy = lines.filter(l =>
    /(Exited|Dead|Restarting)/i.test(l) && !l.includes('(healthy)')
  );
  return unhealthy.length === 0;
}

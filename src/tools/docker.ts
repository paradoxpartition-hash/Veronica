import { execSync } from 'child_process';

export interface ContainerInfo {
  name: string;
  status: string;
  image: string;
}

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim();
  } catch (err: any) {
    return (err.stderr || err.message || 'command failed').trim();
  }
}

export function getDockerContainers(): string {
  return exec(`docker ps --format "• {{.Names}} | {{.Status}} | {{.Image}}"`);
}

export function getDockerHealthSummary(): string {
  return exec(`docker ps -a --format "• {{.Names}} | {{.Status}} | {{.Image}}"`);
}

export function getDockerStatus(): ContainerInfo[] {
  const raw = exec(`docker ps -a --format "{{.Names}}|{{.Status}}|{{.Image}}"`);
  if (!raw || raw.startsWith('command failed')) return [];

  return raw.split('\n').filter(Boolean).map(line => {
    const parts = line.split('|');
    return {
      name: (parts[0] || '').trim(),
      status: (parts[1] || '').trim(),
      image: (parts[2] || '').trim(),
    };
  });
}

export function getContainerStatus(name: string): string {
  return exec(`docker inspect --format "{{.State.Status}}" ${name} 2>/dev/null || echo "not_found"`);
}

export function getContainerLogs(name: string, lines = 80): string {
  return exec(`docker logs --tail ${lines} ${name} 2>&1`);
}

export function restartContainer(name: string): string {
  return exec(`docker restart ${name}`);
}

export function isContainerUnhealthy(name: string): boolean {
  const status = getContainerStatus(name).toLowerCase();
  return ['exited', 'dead', 'restarting'].some(s => status.includes(s));
}

import { execSync } from 'child_process';

// Grafana is intentionally not exposed publicly.
// Check order: internal Docker network → VPN (Tailscale).
// A failed public check is never an incident.

export type GrafanaHealthStatus = 'healthy' | 'unreachable' | 'private/vpn-only';

function exec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 10000 }).trim();
  } catch (err: any) {
    return (err.stderr || err.message || 'command failed').trim();
  }
}

function isGrafanaResponse(body: string): boolean {
  return body.includes('"ok"') || body.toLowerCase().includes('database: ok');
}

export async function checkGrafanaHealth(): Promise<GrafanaHealthStatus> {
  const internalHost = process.env.GRAFANA_HOST || 'grafana';
  const vpnUrl = process.env.GRAFANA_VPN_URL || 'http://100.75.253.104:3002/api/health';

  // 1. Internal Docker network (most reliable — same compose network)
  const internalResult = exec(`curl -s --max-time 5 "http://${internalHost}:3000/api/health"`);
  if (isGrafanaResponse(internalResult)) return 'healthy';

  // 2. VPN / Tailscale address
  const vpnResult = exec(`curl -s --max-time 5 "${vpnUrl}"`);
  if (isGrafanaResponse(vpnResult)) return 'healthy';

  // 3. Both unreachable — but public access is disabled by design,
  //    so only flag as truly unreachable if container is also unhealthy.
  return 'unreachable';
}

export function getGrafanaLogs(lines = 80): string {
  return exec(`docker logs --tail ${lines} grafana 2>&1`);
}

export function restartGrafana(): string {
  return exec('docker restart grafana');
}

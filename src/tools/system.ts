import si from 'systeminformation';
import { execSync } from 'child_process';

export interface SystemHealth {
  cpu: number;
  ramUsedGb: number;
  ramTotalGb: number;
  ramPercent: number;
  diskUsedPercent: number;
  uptimeHours: number;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const [load, mem, fs, time] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.time(),
  ]);

  const ramUsedGb = mem.used / 1024 / 1024 / 1024;
  const ramTotalGb = mem.total / 1024 / 1024 / 1024;

  return {
    cpu: load.currentLoad,
    ramUsedGb,
    ramTotalGb,
    ramPercent: (ramUsedGb / ramTotalGb) * 100,
    diskUsedPercent: fs[0]?.use ?? 0,
    uptimeHours: Math.floor((time.uptime || 0) / 3600),
  };
}

export function getDiskUsage(): string {
  try {
    return execSync('df -h /', { encoding: 'utf-8' }).trim();
  } catch {
    return 'Unable to retrieve disk usage.';
  }
}

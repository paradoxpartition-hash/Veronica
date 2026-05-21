import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { getSystemHealth } from '../tools/system';
import { getPrometheusLogs, restartPrometheus } from '../tools/prometheus';
import { getGrafanaLogs, restartGrafana } from '../tools/grafana';
import { getDockerStatus, isContainerUnhealthy } from '../tools/docker';
import { logIncident, getIncidentsSince, formatIncidents } from '../incidents';
import { SERVICES } from '../identity';

// ─── Cooldowns ───────────────────────────────────────────────────────────────

const cooldowns: Record<string, number> = {};
const COOLDOWN_MS = 600_000; // 10 min

function onCooldown(key: string): boolean {
  return Date.now() - (cooldowns[key] || 0) < COOLDOWN_MS;
}

function setCooldown(key: string): void {
  cooldowns[key] = Date.now();
}

// ─── Self-heal ────────────────────────────────────────────────────────────────

async function healContainer(
  bot: Telegraf,
  userId: string,
  containerName: string,
  label: string,
  restartFn: () => string,
  logsFn: () => string
): Promise<void> {
  const healKey = `${containerName}_heal`;
  if (onCooldown(healKey)) return;
  if (!isContainerUnhealthy(containerName)) return;

  setCooldown(healKey);
  restartFn();
  await new Promise(r => setTimeout(r, 4000));

  const stillBad = isContainerUnhealthy(containerName);
  const result = stillBad ? 'Still unhealthy after restart' : 'Recovered successfully';

  await logIncident({
    service: label.toLowerCase(),
    symptom: 'Container stopped/dead/restarting (detected by watchdog)',
    evidence: `isContainerUnhealthy("${containerName}") = true`,
    actionTaken: 'Auto-restarted (SAFE_AUTO — monitoring container)',
    result,
  });

  await bot.telegram.sendMessage(
    userId,
    stillBad
      ? `⚠️ *Auto-heal:* ${label} was stopped — restarted but still unhealthy. Manual check needed.\n\nLogs:\n\`\`\`\n${logsFn().slice(0, 600)}\n\`\`\``
      : `🔧 *Auto-heal:* ${label} was stopped — restarted successfully. ✅`,
    { parse_mode: 'Markdown' }
  );
}

// ─── Resource alerts ─────────────────────────────────────────────────────────

async function resourceAlerts(bot: Telegraf, userId: string): Promise<void> {
  try {
    const h = await getSystemHealth();

    if (h.cpu > 85 && !onCooldown('alert_cpu')) {
      setCooldown('alert_cpu');
      await bot.telegram.sendMessage(userId, `⚠️ *HIGH CPU:* ${h.cpu.toFixed(1)}%`, { parse_mode: 'Markdown' });
    }

    if (h.ramPercent > 90 && !onCooldown('alert_ram')) {
      setCooldown('alert_ram');
      await bot.telegram.sendMessage(
        userId,
        `⚠️ *HIGH RAM:* ${h.ramPercent.toFixed(1)}% (${h.ramUsedGb.toFixed(1)} / ${h.ramTotalGb.toFixed(1)} GB)`,
        { parse_mode: 'Markdown' }
      );
    }

    if (h.diskUsedPercent > 90 && !onCooldown('alert_disk')) {
      setCooldown('alert_disk');
      await bot.telegram.sendMessage(userId, `⚠️ *DISK CRITICAL:* ${h.diskUsedPercent.toFixed(1)}% used`, { parse_mode: 'Markdown' });
    }
  } catch (err: any) {
    console.error('Resource watchdog error:', err.message);
  }
}

// ─── Hourly scan ─────────────────────────────────────────────────────────────
// Silent unless something is wrong. Checks all known service containers.

async function hourlyScan(bot: Telegraf, userId: string): Promise<void> {
  const problems: string[] = [];

  for (const [name, svc] of Object.entries(SERVICES)) {
    if (isContainerUnhealthy(svc.containerName)) {
      problems.push(`• *${name}* (\`${svc.containerName}\`) — stopped/dead/restarting`);
    }
  }

  if (problems.length === 0) return; // All clear — stay silent

  if (onCooldown('hourly_scan_alert')) return;
  setCooldown('hourly_scan_alert');

  await bot.telegram.sendMessage(
    userId,
    `🔍 *Hourly scan — issues detected:*\n\n${problems.join('\n')}\n\nSend me "fix [service]" to act.`,
    { parse_mode: 'Markdown' }
  );
}

// ─── Morning report ──────────────────────────────────────────────────────────
// Sent daily at 08:00. Always fires — not silenced by cooldowns.

async function morningReport(bot: Telegraf, userId: string): Promise<void> {
  try {
    const h = await getSystemHealth();
    const containers = getDockerStatus();
    const overnightIncidents = await getIncidentsSince(Date.now() - 8 * 3600 * 1000);

    // Build service status lines from known services
    const serviceLines = Object.entries(SERVICES).map(([name, svc]) => {
      const c = containers.find(c => c.name === svc.containerName);
      if (!c) return `❓ *${name}* — container not found`;
      const bad = ['exited', 'dead', 'restarting'].some(s => c.status.toLowerCase().includes(s));
      const icon = bad ? '⚠️' : '✅';
      return `${icon} *${name}* — ${c.status}`;
    }).join('\n');

    // CPU/RAM/Disk verdicts
    const cpuOk = h.cpu < 70;
    const ramOk = h.ramPercent < 80;
    const diskOk = h.diskUsedPercent < 80;
    const systemIcon = (cpuOk && ramOk && diskOk) ? '✅' : '⚠️';

    const date = new Date().toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long',
    });

    const report = `🌅 *VERONICA MORNING REPORT*
_${date}_

${systemIcon} *System:*
CPU: ${h.cpu.toFixed(1)}% | RAM: ${h.ramPercent.toFixed(1)}% | Disk: ${h.diskUsedPercent.toFixed(1)}% | Uptime: ${h.uptimeHours}h

*Services:*
${serviceLines}

*Overnight incidents (last 8h):*
${formatIncidents(overnightIncidents)}`;

    await bot.telegram.sendMessage(userId, report, { parse_mode: 'Markdown' });
  } catch (err: any) {
    console.error('Morning report error:', err.message);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

export function startWatchdog(bot: Telegraf, userId: string): void {
  // Every 5 min: resource alerts + self-heal Prometheus/Grafana
  cron.schedule('*/5 * * * *', async () => {
    await resourceAlerts(bot, userId);
    await healContainer(bot, userId, 'prometheus', 'Prometheus', restartPrometheus, () => getPrometheusLogs(30));
    await healContainer(bot, userId, 'grafana', 'Grafana', restartGrafana, () => getGrafanaLogs(30));
  });

  // Every hour: silent container scan across all known services
  cron.schedule('0 * * * *', async () => {
    await hourlyScan(bot, userId);
  });

  // Every day at 08:00: morning health report
  cron.schedule('0 8 * * *', async () => {
    await morningReport(bot, userId);
  });

  console.log('VERONICA WATCHDOG ACTIVE — self-heal, hourly scan, morning report enabled');
}

import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { getSystemHealth } from '../tools/system';
import { getPrometheusLogs, restartPrometheus } from '../tools/prometheus';
import { getGrafanaLogs, restartGrafana } from '../tools/grafana';
import { getContainerStatus, isContainerUnhealthy } from '../tools/docker';

// Watchdog uses Docker container state as the authoritative health source.
// HTTP health checks are NOT used here — Veronica may be on a different Docker
// network than Prometheus/Grafana, making curl failures meaningless as alerts.

const cooldowns: Record<string, number> = {};
const COOLDOWN_MS = 600_000; // 10 minutes

function onCooldown(key: string): boolean {
  return Date.now() - (cooldowns[key] || 0) < COOLDOWN_MS;
}

function setCooldown(key: string): void {
  cooldowns[key] = Date.now();
}

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

  if (!isContainerUnhealthy(containerName)) return; // running = fine

  setCooldown(healKey);
  const statusBefore = getContainerStatus(containerName);

  restartFn();
  await new Promise(r => setTimeout(r, 4000));

  const stillBad = isContainerUnhealthy(containerName);
  await bot.telegram.sendMessage(
    userId,
    stillBad
      ? `⚠️ *Auto-heal:* ${label} was \`${statusBefore}\` — restarted but still unhealthy. Manual check needed.\n\nLogs:\n\`\`\`\n${logsFn().slice(0, 600)}\n\`\`\``
      : `🔧 *Auto-heal:* ${label} was \`${statusBefore}\` — restarted successfully. ✅`,
    { parse_mode: 'Markdown' }
  );
}

async function resourceAlerts(bot: Telegraf, userId: string): Promise<void> {
  try {
    const h = await getSystemHealth();

    if (h.cpu > 85 && !onCooldown('alert_cpu')) {
      setCooldown('alert_cpu');
      await bot.telegram.sendMessage(
        userId,
        `⚠️ *HIGH CPU:* ${h.cpu.toFixed(1)}%`,
        { parse_mode: 'Markdown' }
      );
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
      await bot.telegram.sendMessage(
        userId,
        `⚠️ *DISK CRITICAL:* ${h.diskUsedPercent.toFixed(1)}% used`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (err: any) {
    console.error('Watchdog resource check failed:', err.message);
  }
}

export function startWatchdog(bot: Telegraf, userId: string): void {
  cron.schedule('*/5 * * * *', async () => {
    await resourceAlerts(bot, userId);
    await healContainer(bot, userId, 'prometheus', 'Prometheus', restartPrometheus, () => getPrometheusLogs(30));
    await healContainer(bot, userId, 'grafana', 'Grafana', restartGrafana, () => getGrafanaLogs(30));
  });

  console.log('VERONICA WATCHDOG ACTIVE — self-heal enabled for Prometheus & Grafana');
}

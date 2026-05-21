import cron from 'node-cron';
import { Telegraf } from 'telegraf';
import { getSystemHealth } from '../tools/system';
import { checkPrometheusHealth, getPrometheusLogs, restartPrometheus } from '../tools/prometheus';
import { checkGrafanaHealth, getGrafanaLogs, restartGrafana } from '../tools/grafana';
import { isContainerUnhealthy } from '../tools/docker';

// Per-alert cooldown map — prevents spam for sustained issues.
// Key = alert type, value = last fire timestamp.
const cooldowns: Record<string, number> = {};
const COOLDOWN_MS = 600_000; // 10 minutes

function onCooldown(key: string): boolean {
  return Date.now() - (cooldowns[key] || 0) < COOLDOWN_MS;
}

function setCooldown(key: string): void {
  cooldowns[key] = Date.now();
}

async function healPrometheus(bot: Telegraf, userId: string): Promise<void> {
  if (onCooldown('prometheus_heal')) return;

  const healthy = await checkPrometheusHealth();
  if (healthy) return;

  const stopped = isContainerUnhealthy('prometheus');

  if (stopped) {
    setCooldown('prometheus_heal');
    restartPrometheus();
    await new Promise(r => setTimeout(r, 4000));
    const nowOk = await checkPrometheusHealth();
    await bot.telegram.sendMessage(
      userId,
      nowOk
        ? `🔧 *Auto-heal:* Prometheus was stopped — restarted successfully. ✅`
        : `⚠️ *Auto-heal:* Prometheus restarted but still unreachable. Manual check needed.`,
      { parse_mode: 'Markdown' }
    );
  } else if (!onCooldown('prometheus_alert')) {
    setCooldown('prometheus_alert');
    const logs = getPrometheusLogs(30).slice(0, 600);
    await bot.telegram.sendMessage(
      userId,
      `⚠️ *Prometheus unreachable* (container running — possible config issue)\n\nRecent logs:\n\`\`\`\n${logs}\n\`\`\``,
      { parse_mode: 'Markdown' }
    );
  }
}

async function healGrafana(bot: Telegraf, userId: string): Promise<void> {
  if (onCooldown('grafana_heal')) return;

  const status = await checkGrafanaHealth();

  // Grafana is private/VPN-only by design — not an incident.
  if (status === 'healthy') return;

  const stopped = isContainerUnhealthy('grafana');

  // Only auto-restart when internal health check fails AND container is stopped.
  if (status === 'unreachable' && stopped) {
    setCooldown('grafana_heal');
    restartGrafana();
    await new Promise(r => setTimeout(r, 4000));
    const afterStatus = await checkGrafanaHealth();
    await bot.telegram.sendMessage(
      userId,
      afterStatus === 'healthy'
        ? `🔧 *Auto-heal:* Grafana was stopped — restarted successfully. ✅`
        : `⚠️ *Auto-heal:* Grafana restarted but still unreachable internally. Manual check needed.`,
      { parse_mode: 'Markdown' }
    );
  } else if (status === 'unreachable' && !stopped && !onCooldown('grafana_alert')) {
    // Container is running but internal health endpoint failed — possible config issue.
    setCooldown('grafana_alert');
    const logs = getGrafanaLogs(30).slice(0, 600);
    await bot.telegram.sendMessage(
      userId,
      `⚠️ *Grafana internal health failed* (container running — possible config issue)\n\nRecent logs:\n\`\`\`\n${logs}\n\`\`\``,
      { parse_mode: 'Markdown' }
    );
  }
  // status === 'private/vpn-only': no alert — this is expected and intentional.
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
    await healPrometheus(bot, userId);
    await healGrafana(bot, userId);
  });

  console.log('VERONICA WATCHDOG ACTIVE — self-heal enabled for Prometheus & Grafana');
}

import { ChatOllama } from '@langchain/ollama';
import { setLastTopic, getLastTopic } from './memory';
import { requestApproval } from './approvals';
import { classifyAction, isMonitoringContainer } from './safety';
import { buildIdentityContext, buildSelfAwarenessReport } from './identity';
import { logIncident, getIncidentsForService, getRecentIncidents, formatIncidents } from './incidents';
import {
  getDockerHealthSummary,
  getContainerStatus,
  getContainerLogs,
  restartContainer,
  isContainerUnhealthy,
} from './tools/docker';
import { getSystemHealth, getDiskUsage } from './tools/system';
import { checkPrometheusHealth, getPrometheusLogs, restartPrometheus } from './tools/prometheus';
import { checkGrafanaHealth, getGrafanaLogs, restartGrafana } from './tools/grafana';
import { checkMailcowHealth, getMailcowWatchdogLogs, isMailcowHealthy } from './tools/mailcow';
import { checkNginxHealth, getNginxLogs, restartNginx } from './tools/nginx';

// ─── Intent ──────────────────────────────────────────────────────────────────

type IntentType =
  | 'DIAGNOSE_SERVICE'
  | 'FIX_SERVICE'
  | 'CHECK_HEALTH'
  | 'CHECK_LOGS'
  | 'RESTART_CONTAINER'
  | 'CHECK_DISK'
  | 'SELF_AWARENESS'
  | 'GENERAL';

interface Intent {
  type: IntentType;
  service?: string;
}

const FOLLOW_UP_PHRASES = [
  "what?", "why?", "fix it", "do it", "check it", "what exactly",
  "go deeper", "tell me more", "try it", "and?", "then?", "now what", "so?",
];

const SERVICE_ALIASES: Record<string, string> = {
  prometheus: 'prometheus',
  grafana: 'grafana',
  mailcow: 'mailcow',
  mail: 'mailcow',
  nginx: 'nginx',
  npm: 'nginx',
  'proxy manager': 'nginx',
  'nginx proxy manager': 'nginx',
  portainer: 'portainer',
  saasolution: 'saasolution',
  saas: 'saasolution',
};

function resolveService(message: string): string | undefined {
  const m = message.toLowerCase();
  for (const [alias, service] of Object.entries(SERVICE_ALIASES)) {
    if (m.includes(alias)) return service;
  }
  return undefined;
}

function detectIntent(message: string, lastTopic: string): Intent {
  const m = message.toLowerCase().trim();

  // Follow-up
  const isFollowUp = FOLLOW_UP_PHRASES.some(
    p => m === p || m.startsWith(p + ' ') || m.endsWith(' ' + p)
  );
  if (isFollowUp && lastTopic) return detectIntent(lastTopic, '');

  // Self-awareness
  if (/what are you|what can you do|your capabilities|what do you know|what are you responsible|list your|your limits|what services|who are you/.test(m)) {
    return { type: 'SELF_AWARENESS' };
  }

  const service = resolveService(m);

  if (/disk|space|storage|full/.test(m)) return { type: 'CHECK_DISK' };

  if (/health|status|overview|how are you|everything ok|all good|how is everything/.test(m) && !service) {
    return { type: 'CHECK_HEALTH' };
  }

  if (/logs?|output/.test(m) && service) return { type: 'CHECK_LOGS', service };

  if (/restart|reboot/.test(m) && service) return { type: 'RESTART_CONTAINER', service };

  if (/fix|repair|heal|resolve|recover/.test(m) && service) return { type: 'FIX_SERVICE', service };

  if (service && /check|diagnose|what|why|unreachable|down|not working|broken|issue|problem|fail/.test(m)) {
    return { type: 'DIAGNOSE_SERVICE', service };
  }

  if (service) return { type: 'DIAGNOSE_SERVICE', service };

  return { type: 'GENERAL' };
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface GatheredContext {
  systemHealth: Awaited<ReturnType<typeof getSystemHealth>>;
  dockerSummary: string;
  serviceData: Record<string, string>;
  pastIncidents: string;
}

async function gatherContext(intent: Intent): Promise<GatheredContext> {
  const [systemHealth, dockerSummary] = await Promise.all([
    getSystemHealth(),
    Promise.resolve(getDockerHealthSummary()),
  ]);

  const serviceData: Record<string, string> = {};
  const service = intent.service;

  // Past incidents — include when diagnosing or fixing a service
  let pastIncidents = '';
  if (service && ['DIAGNOSE_SERVICE', 'FIX_SERVICE', 'CHECK_LOGS'].includes(intent.type)) {
    const incidents = await getIncidentsForService(service, 3);
    pastIncidents = formatIncidents(incidents);
  }

  if (intent.type === 'CHECK_HEALTH') {
    const [pOk, grafanaStatus, nOk] = await Promise.all([
      checkPrometheusHealth(),
      checkGrafanaHealth(),
      checkNginxHealth(),
    ]);
    serviceData['prometheus_healthy'] = String(pOk);
    serviceData['grafana_status'] = grafanaStatus;
    serviceData['nginx_healthy'] = String(nOk);
    serviceData['mailcow_status'] = checkMailcowHealth();
    const recent = await getRecentIncidents(5);
    pastIncidents = formatIncidents(recent);
  }

  if (service === 'prometheus') {
    const healthy = await checkPrometheusHealth();
    serviceData['prometheus_healthy'] = String(healthy);
    serviceData['prometheus_container'] = getContainerStatus('prometheus');
    if (!healthy || intent.type === 'CHECK_LOGS') {
      serviceData['prometheus_logs'] = getPrometheusLogs(100);
    }
  }

  if (service === 'grafana') {
    const grafanaStatus = await checkGrafanaHealth();
    serviceData['grafana_status'] = grafanaStatus;
    serviceData['grafana_container'] = getContainerStatus('grafana');
    if (grafanaStatus === 'unreachable' || intent.type === 'CHECK_LOGS') {
      serviceData['grafana_logs'] = getGrafanaLogs(80);
    }
  }

  if (service === 'mailcow') {
    serviceData['mailcow_status'] = checkMailcowHealth();
    if (['CHECK_LOGS', 'DIAGNOSE_SERVICE', 'FIX_SERVICE'].includes(intent.type)) {
      serviceData['mailcow_watchdog_logs'] = getMailcowWatchdogLogs(120);
    }
  }

  if (service === 'nginx') {
    const healthy = await checkNginxHealth();
    serviceData['nginx_healthy'] = String(healthy);
    serviceData['nginx_container'] = getContainerStatus('nginx-proxy-manager');
    if (!healthy || intent.type === 'CHECK_LOGS') {
      serviceData['nginx_logs'] = getNginxLogs(80);
    }
  }

  if (service === 'portainer') {
    serviceData['portainer_container'] = getContainerStatus('portainer');
    if (intent.type === 'CHECK_LOGS') {
      serviceData['portainer_logs'] = getContainerLogs('portainer', 60);
    }
  }

  if (service === 'saasolution') {
    serviceData['saasolution_container'] = getContainerStatus('saasolution');
    if (intent.type === 'CHECK_LOGS') {
      serviceData['saasolution_logs'] = getContainerLogs('saasolution', 80);
    }
  }

  if (intent.type === 'CHECK_DISK') {
    serviceData['disk_detail'] = getDiskUsage();
  }

  return { systemHealth, dockerSummary, serviceData, pastIncidents };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

interface ActionResult {
  action: string;
  status: 'executed' | 'queued_for_approval' | 'blocked' | 'skipped';
  output?: string;
}

const CONTAINER_MAP: Record<string, string> = {
  prometheus: 'prometheus',
  grafana: 'grafana',
  nginx: 'nginx-proxy-manager',
  mailcow: 'mailcowdockerized-watchdog-mailcow-1',
  portainer: 'portainer',
  saasolution: 'saasolution',
};

async function planAndExecute(
  intent: Intent,
  context: GatheredContext,
  userId: string,
  bot: any
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  const service = intent.service;

  if ((intent.type === 'FIX_SERVICE' || intent.type === 'DIAGNOSE_SERVICE') && service) {

    if (service === 'prometheus') {
      const healthy = context.serviceData['prometheus_healthy'] === 'true';
      const stopped = isContainerUnhealthy('prometheus');

      if (!healthy && stopped && intent.type === 'FIX_SERVICE') {
        const level = classifyAction('restart_prometheus');
        if (level === 'SAFE_AUTO') {
          const output = restartPrometheus();
          results.push({ action: 'restart_prometheus', status: 'executed', output });
          await new Promise(r => setTimeout(r, 3500));
          const nowOk = await checkPrometheusHealth();
          context.serviceData['prometheus_healthy_after'] = String(nowOk);
          await logIncident({
            service: 'prometheus',
            symptom: 'Container stopped/unhealthy',
            evidence: `Container status before restart: stopped`,
            actionTaken: 'Auto-restarted (SAFE_AUTO)',
            result: nowOk ? 'Recovered — healthy' : 'Still unreachable after restart',
          });
        }
      }
    }

    if (service === 'grafana') {
      const grafanaStatus = context.serviceData['grafana_status'];
      const stopped = isContainerUnhealthy('grafana');

      if (grafanaStatus === 'unreachable' && stopped && intent.type === 'FIX_SERVICE') {
        const level = classifyAction('restart_grafana');
        if (level === 'SAFE_AUTO') {
          const output = restartGrafana();
          results.push({ action: 'restart_grafana', status: 'executed', output });
          await new Promise(r => setTimeout(r, 3500));
          const afterStatus = await checkGrafanaHealth();
          context.serviceData['grafana_status_after'] = afterStatus;
          await logIncident({
            service: 'grafana',
            symptom: 'Container stopped/unhealthy',
            evidence: 'Container status: stopped, internal health check failed',
            actionTaken: 'Auto-restarted (SAFE_AUTO)',
            result: afterStatus === 'healthy' ? 'Recovered — healthy' : `Still ${afterStatus} after restart`,
          });
        }
      }
    }

    if (service === 'mailcow' && intent.type === 'FIX_SERVICE') {
      if (!isMailcowHealthy()) {
        await requestApproval(
          bot, userId,
          'restart_mailcow',
          'Mailcow appears unhealthy. Restart core mail services?',
          async () => {
            const out = restartContainer('mailcowdockerized-postfix-mailcow-1');
            await logIncident({
              service: 'mailcow',
              symptom: 'Unhealthy containers detected',
              evidence: 'isMailcowHealthy() returned false',
              actionTaken: 'Restarted postfix container (approved by Othman)',
              result: out,
            });
            return out;
          }
        );
        results.push({ action: 'restart_mailcow', status: 'queued_for_approval' });
      }
    }

    if (service === 'nginx' && intent.type === 'FIX_SERVICE') {
      const stopped = isContainerUnhealthy('nginx-proxy-manager');
      if (stopped) {
        await requestApproval(
          bot, userId,
          'restart_nginx_proxy_manager',
          'Nginx Proxy Manager container is stopped. Restart it?',
          async () => {
            const out = restartNginx();
            await logIncident({
              service: 'nginx',
              symptom: 'Container stopped',
              evidence: 'isContainerUnhealthy returned true',
              actionTaken: 'Restarted nginx-proxy-manager (approved by Othman)',
              result: out,
            });
            return out;
          }
        );
        results.push({ action: 'restart_nginx_proxy_manager', status: 'queued_for_approval' });
      }
    }

    if ((service === 'portainer' || service === 'saasolution') && intent.type === 'FIX_SERVICE') {
      const containerName = CONTAINER_MAP[service];
      await requestApproval(
        bot, userId,
        `restart_${service}`,
        `Restart ${service} (${containerName})?`,
        async () => {
          const out = restartContainer(containerName);
          await logIncident({
            service,
            symptom: 'Manual fix requested',
            evidence: 'User requested fix via Telegram',
            actionTaken: `Restarted ${containerName} (approved by Othman)`,
            result: out,
          });
          return out;
        }
      );
      results.push({ action: `restart_${service}`, status: 'queued_for_approval' });
    }
  }

  if (intent.type === 'RESTART_CONTAINER' && service) {
    const containerName = CONTAINER_MAP[service] || service;
    const actionKey = isMonitoringContainer(containerName)
      ? `restart_${service}`
      : 'restart_container';
    const level = classifyAction(actionKey);

    if (level === 'SAFE_AUTO') {
      const output = restartContainer(containerName);
      results.push({ action: `restart_${service}`, status: 'executed', output });
    } else if (level === 'REQUIRES_APPROVAL') {
      await requestApproval(
        bot, userId,
        `restart_${service}`,
        `Restart ${service} (${containerName})?`,
        async () => restartContainer(containerName)
      );
      results.push({ action: `restart_${service}`, status: 'queued_for_approval' });
    } else {
      results.push({ action: `restart_${service}`, status: 'blocked' });
    }
  }

  return results;
}

// ─── Response generation ──────────────────────────────────────────────────────

const model = new ChatOllama({
  baseUrl: process.env.OLLAMA_HOST || 'http://ollama:11434',
  model: process.env.OLLAMA_MODEL || 'llama3',
  temperature: 0.1,
});

async function generateResponse(
  intent: Intent,
  originalMessage: string,
  context: GatheredContext,
  actions: ActionResult[]
): Promise<string> {
  const { systemHealth, dockerSummary, serviceData, pastIncidents } = context;

  const actionsText = actions.length > 0
    ? actions.map(r => {
        if (r.status === 'executed') return `EXECUTED: ${r.action} → ${r.output || 'done'}`;
        if (r.status === 'queued_for_approval') return `PENDING APPROVAL: ${r.action}`;
        if (r.status === 'blocked') return `BLOCKED (FORBIDDEN): ${r.action}`;
        return `SKIPPED: ${r.action}`;
      }).join('\n')
    : 'No actions taken.';

  const serviceContext = Object.entries(serviceData)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const prompt = `${buildIdentityContext()}

---
User said: "${originalMessage}"

LIVE SYSTEM:
CPU: ${systemHealth.cpu.toFixed(1)}% | RAM: ${systemHealth.ramPercent.toFixed(1)}% (${systemHealth.ramUsedGb.toFixed(1)}/${systemHealth.ramTotalGb.toFixed(1)} GB) | Disk: ${systemHealth.diskUsedPercent.toFixed(1)}% | Uptime: ${systemHealth.uptimeHours}h

DOCKER STATUS:
${dockerSummary}

SERVICE DATA:
${serviceContext || 'None collected.'}

PAST INCIDENTS (relevant):
${pastIncidents || 'None on record.'}

ACTIONS I TOOK:
${actionsText}

RULES:
- Never output JSON, code blocks, or tell the user to run commands.
- Never invent data not shown above.
- "Up X hours" without (unhealthy)/Exited/Dead/Restarting = HEALTHY.
- CPU <70%, RAM <80%, Disk <80% are normal.
- Grafana VPN-only = by design, not a failure.
- If approval is pending, tell Othman to check the approval message.
- Always explain what you did and why.
- Be concise and direct. Max 350 words.

FORMAT:
Health verdict: [Healthy / Warning / Critical / Unknown]
Findings: what you observed
Actions taken: what was done and why
Pending approval: action name, or "None"
Next step: one concrete recommendation, or "None needed"`;

  try {
    const response = await model.invoke([{ role: 'user', content: prompt }]);
    const text = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
    return text.slice(0, 3500);
  } catch (err: any) {
    return [
      `Actions: ${actionsText}`,
      serviceContext ? `Context:\n${serviceContext}` : '',
      `System: CPU ${systemHealth.cpu.toFixed(1)}% | RAM ${systemHealth.ramPercent.toFixed(1)}% | Disk ${systemHealth.diskUsedPercent.toFixed(1)}%`,
      pastIncidents ? `Past incidents:\n${pastIncidents}` : '',
    ].filter(Boolean).join('\n\n');
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function processMessage(
  message: string,
  userId: string,
  bot: any
): Promise<string> {
  const lastTopic = await getLastTopic(userId);
  const intent = detectIntent(message, lastTopic);

  // Self-awareness: answer directly, no LLM needed
  if (intent.type === 'SELF_AWARENESS') {
    await setLastTopic(userId, message);
    const recent = await getRecentIncidents(5);
    return buildSelfAwarenessReport(formatIncidents(recent));
  }

  const context = await gatherContext(intent);
  const actions = await planAndExecute(intent, context, userId, bot);
  await setLastTopic(userId, message);
  return generateResponse(intent, message, context, actions);
}

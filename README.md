# V.E.R.O.N.I.C.A.

**Variable Emergency Response Organic Network Integrated Combat Armor**

Autonomous AI infrastructure operator for your VPS. Talks naturally via Telegram. Acts safely. Asks before touching anything critical.

---

## How it works

Send Veronica a plain-text Telegram message. She detects your intent, gathers live system context, executes safe actions automatically, and asks your approval before anything risky.

**Examples:**

```
"Veronica, Prometheus is unreachable. Fix what you safely can."
→ Checks container status, reads logs, restarts automatically if stopped, confirms result.

"How's everything?"
→ Full health report: CPU, RAM, disk, all service statuses.

"Show me the Mailcow watchdog logs."
→ Fetches last 120 lines of mailcow watchdog logs.

"Fix Grafana."
→ Checks health, restarts if stopped (auto), or asks approval if config issue suspected.

"Restart Nginx Proxy Manager."
→ Sends approval buttons — executes only on your confirmation.

"check it" / "go deeper" / "why?"
→ Continues from the previous topic automatically.
```

---

## Safety policy

| Level | Actions |
|-------|---------|
| **SAFE_AUTO** | Read logs, check health, check disk, docker status, restart Prometheus/Grafana if stopped |
| **REQUIRES_APPROVAL** | Restart Mailcow, Nginx Proxy Manager, Portainer, SaaSolution, edit configs, deploy, reboot |
| **FORBIDDEN** | Delete databases, disable firewall, remove volumes, expose secrets |

---

## Setup

### 1. Clone and configure

```bash
git clone https://github.com/paradoxpartition-hash/Veronica
cd Veronica
cp .env.example .env
nano .env   # fill in your tokens
```

### 2. Required `.env` values

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `AUTHORIZED_USER_ID` | Your Telegram user ID (send `/start` to get it) |
| `OLLAMA_MODEL` | Model to use, e.g. `llama3`, `mistral`, `qwen2.5` |

### 3. Start

```bash
docker compose up -d --build
```

### 4. Pull a model (first run only)

```bash
docker exec veronica-ollama ollama pull llama3
```

---

## Architecture

```
src/
  index.ts              — Bot entry, text handler, approval callback handler
  agent.ts              — Orchestrator: intent detection → context → actions → response
  safety.ts             — Action classification: SAFE_AUTO / REQUIRES_APPROVAL / FORBIDDEN
  approvals.ts          — Telegram inline keyboard approvals, Redis-backed
  memory.ts             — Redis memory: per-user last topic, short-term context
  tools/
    docker.ts           — Docker status, logs, restart, health checks
    system.ts           — CPU, RAM, disk, uptime
    prometheus.ts       — Prometheus health, logs, restart
    grafana.ts          — Grafana health, logs, restart
    mailcow.ts          — Mailcow container status and logs
    nginx.ts            — Nginx Proxy Manager health and logs
  monitoring/
    watchdog.ts         — Self-healing cron: alerts + auto-restart monitoring containers
  webhook.ts            — GitHub webhook for auto-deploy (optional)
```

---

## Self-healing

Every 5 minutes the watchdog:
- Checks Prometheus and Grafana health
- If either is stopped/exited → **restarts automatically** and notifies you
- If either is running but unreachable → sends alert with recent logs
- Alerts on CPU >85%, RAM >90%, Disk >90% (10-minute cooldown per alert)

---

## Adding a model via Ollama

```bash
docker exec veronica-ollama ollama list        # see installed models
docker exec veronica-ollama ollama pull llama3  # install a model
```

Recommended models for infrastructure reasoning: `llama3`, `mistral`, `qwen2.5:7b`

---

## GitHub webhook auto-deploy (optional)

The webhook server runs on port 4000. Configure a GitHub webhook pointing to `http://your-vps:4000/github-webhook` with a secret matching `GITHUB_WEBHOOK_SECRET`.

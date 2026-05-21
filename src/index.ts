import dotenv from "dotenv";
dotenv.config();

import { Telegraf } from "telegraf";
import si from "systeminformation";
import { execSync } from "child_process";
import cron from "node-cron";
import axios from "axios";

import { getDockerContainers, getDockerHealthSummary } from "./tools/docker";
import { getSystemHealth } from "./tools/system";
import { askVeronica } from "./agent";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const AUTHORIZED_USER = process.env.AUTHORIZED_USER_ID;

function isAuthorized(ctx: any): boolean {
    return String(ctx.from?.id) === AUTHORIZED_USER;
}

async function getHealthReport() {
    const load = await si.currentLoad();
    const mem = await si.mem();
    const fs = await si.fsSize();

    return {
        cpu: load.currentLoad,
        ramUsed: mem.used / 1024 / 1024 / 1024,
        ramTotal: mem.total / 1024 / 1024 / 1024,
        diskUsed: fs[0]?.use ?? 0
    };
}

function startWatchdog() {
    cron.schedule("*/5 * * * *", async () => {
        if (!AUTHORIZED_USER) return;

        const report = await getHealthReport();
        const ramPercent = (report.ramUsed / report.ramTotal) * 100;

        if (report.cpu > 85) {
            await bot.telegram.sendMessage(
                AUTHORIZED_USER,
                `⚠️ VERONICA ALERT\n\nHigh CPU usage detected: ${report.cpu.toFixed(1)}%`
            );
        }

        if (ramPercent > 90) {
            await bot.telegram.sendMessage(
                AUTHORIZED_USER,
                `⚠️ VERONICA ALERT\n\nHigh RAM usage detected: ${ramPercent.toFixed(1)}%`
            );
        }

        if (report.diskUsed > 90) {
            await bot.telegram.sendMessage(
                AUTHORIZED_USER,
                `⚠️ VERONICA ALERT\n\nDisk usage critical: ${report.diskUsed.toFixed(1)}%`
            );
        }
    });

    console.log("VERONICA WATCHDOG ACTIVE");
}

bot.start((ctx) => {
    if (!isAuthorized(ctx)) {
        return ctx.reply(`Unauthorized.\n\nYour Telegram ID is: ${ctx.from.id}`);
    }

    ctx.reply(`
VERONICA ONLINE

Variable
Emergency
Response
Organic
Network
Integrated
Combat
Armor

Status: ACTIVE
`);
});

bot.command("status", async (ctx) => {
    if (!isAuthorized(ctx)) {
        return ctx.reply("Unauthorized.");
    }

    const load = await si.currentLoad();
    const mem = await si.mem();
    const fs = await si.fsSize();
    const time = await si.time();

    let dockerStatus = "Unknown";
    let containerCount = "Unknown";

    try {
        dockerStatus = execSync("systemctl is-active docker").toString().trim();
        containerCount = execSync("docker ps --format '{{.Names}}' | wc -l").toString().trim();
    } catch {
        dockerStatus = "Error";
    }

    const mainDisk = fs[0];
    const ramUsedGb = (mem.used / 1024 / 1024 / 1024).toFixed(2);
    const ramTotalGb = (mem.total / 1024 / 1024 / 1024).toFixed(2);

    ctx.reply(`
VERONICA SYSTEM STATUS

CPU Load: ${load.currentLoad.toFixed(1)}%
RAM: ${ramUsedGb} GB / ${ramTotalGb} GB
Disk: ${mainDisk.use.toFixed(1)}% used
Uptime: ${Math.floor(time.uptime / 3600)} hours

Docker: ${dockerStatus}
Running containers: ${containerCount}

NodeJS: OK
Monitoring: ACTIVE
Watchdog: ACTIVE
`);
});

bot.command("containers", async (ctx) => {
    if (!isAuthorized(ctx)) {
        return ctx.reply("Unauthorized.");
    }

    try {

        const containers = execSync(
            `docker ps --format "• {{.Names}} | {{.Status}}"`
        ).toString();

        if (!containers.trim()) {
            return ctx.reply(`
DOCKER CONTAINERS

No running containers detected.
`);
        }

        ctx.reply(`
DOCKER CONTAINERS

${containers}
`);

    } catch (error) {

        ctx.reply(`
ERROR

Unable to retrieve Docker containers.
`);
    }
});

bot.command("run", async (ctx) => {

    if (!isAuthorized(ctx)) {
        return ctx.reply("Unauthorized.");
    }

    const message = ctx.message.text;
    const parts = message.split(" ");

    if (parts.length < 2) {
        return ctx.reply(`
Usage:

/run system-update
`);
    }

    const scriptName = parts[1];

    const allowedScripts: Record<string, string> = {
    "system-update": "/app/scripts/system-update.sh",
    "docker-status": "/app/scripts/docker-status.sh"
};

    if (!allowedScripts[scriptName]) {
        return ctx.reply(`
VERONICA SECURITY

Script not approved.
`);
    }

    try {

        ctx.reply(`
VERONICA

Executing: ${scriptName}
`);

        const output = execSync(
            `sudo ${allowedScripts[scriptName]}`,
            { encoding: "utf-8" }
        );

        ctx.reply(`
VERONICA TASK COMPLETE

${output.slice(0, 3000)}
`);

    } catch (error: any) {

        ctx.reply(`
VERONICA ERROR

${error.message}
`);
    }
});

bot.command("health", async (ctx) => {
    if (!isAuthorized(ctx)) return ctx.reply("Unauthorized.");

    try {
        const output = execSync(`
echo "HOSTNAME: $(hostname)"
echo "UPTIME: $(uptime -p)"
echo "DISK:"
df -h /
echo ""
echo "MEMORY:"
free -h
echo ""
echo "DOCKER:"
docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"
        `, { encoding: "utf-8" });

        ctx.reply(`VERONICA HEALTH REPORT\n\n${output.slice(0, 3500)}`);
    } catch (error: any) {
        ctx.reply(`VERONICA ERROR\n\n${error.message}`);
    }
});

bot.command("restartcontainer", async (ctx) => {
    if (!isAuthorized(ctx)) return ctx.reply("Unauthorized.");

    const parts = ctx.message.text.split(" ");
    const container = parts[1];

    const allowedContainers = ["portainer"];

    if (!container || !allowedContainers.includes(container)) {
        return ctx.reply(`Allowed containers:\n\n${allowedContainers.join("\n")}`);
    }

    try {
        const output = execSync(`docker restart ${container}`, { encoding: "utf-8" });
        ctx.reply(`VERONICA\n\nRestarted container: ${output}`);
    } catch (error: any) {
        ctx.reply(`VERONICA ERROR\n\n${error.message}`);
    }
});

bot.command("dockerlogs", async (ctx) => {
    if (!isAuthorized(ctx)) return ctx.reply("Unauthorized.");

    const parts = ctx.message.text.split(" ");
    const container = parts[1];

    const allowedContainers = ["portainer"];

    if (!container || !allowedContainers.includes(container)) {
        return ctx.reply(`Allowed containers:\n\n${allowedContainers.join("\n")}`);
    }

    try {
        const output = execSync(`docker logs --tail 40 ${container} 2>&1`, { encoding: "utf-8" });
        ctx.reply(`VERONICA LOGS: ${container}\n\n${output.slice(0, 3500)}`);
    } catch (error: any) {
        ctx.reply(`VERONICA ERROR\n\n${error.message}`);
    }
});

const allowedRepos: Record<string, string> = {
    "saasolution": "/opt/projects/apps/SaaSolution"
};

bot.command("gitstatus", async (ctx) => {

    if (!isAuthorized(ctx)) {
        return ctx.reply("Unauthorized.");
    }

    const parts = ctx.message.text.split(" ");
    const repo = parts[1];

    if (!repo || !allowedRepos[repo]) {
        return ctx.reply(`
Allowed repositories:

${Object.keys(allowedRepos).join("\n")}
`);
    }

    try {

        const output = execSync(
            `cd ${allowedRepos[repo]} && git status`,
            { encoding: "utf-8" }
        );

        ctx.reply(`
VERONICA GIT STATUS

${output.slice(0, 3500)}
`);

    } catch (error: any) {

        ctx.reply(`
VERONICA ERROR

${error.message}
`);
    }
});

bot.command("pull", async (ctx) => {

    if (!isAuthorized(ctx)) {
        return ctx.reply("Unauthorized.");
    }

    const parts = ctx.message.text.split(" ");
    const repo = parts[1];

    if (!repo || !allowedRepos[repo]) {
        return ctx.reply(`
Allowed repositories:

${Object.keys(allowedRepos).join("\n")}
`);
    }

    try {

        ctx.reply(`
VERONICA

Pulling latest updates for ${repo}
`);

        const output = execSync(
            `cd ${allowedRepos[repo]} && git pull`,
            { encoding: "utf-8" }
        );

        ctx.reply(`
VERONICA PULL COMPLETE

${output.slice(0, 3500)}
`);

    } catch (error: any) {

        ctx.reply(`
VERONICA ERROR

${error.message}
`);
    }
});

bot.command("deploy", async (ctx) => {
    if (!isAuthorized(ctx)) return ctx.reply("Unauthorized.");

    const parts = ctx.message.text.split(" ");
    const repo = parts[1];

    if (!repo || !allowedRepos[repo]) {
        return ctx.reply(`Allowed repositories:\n\n${Object.keys(allowedRepos).join("\n")}`);
    }

    try {
        ctx.reply(`VERONICA\n\nDeploying ${repo}...`);

        const output = execSync(
            `cd ${allowedRepos[repo]} && git rev-parse HEAD > /opt/veronica/state/${repo}.previous && git pull && docker compose up -d --build && /opt/veronica/scripts/check-saasolution.sh`,
            { encoding: "utf-8", timeout: 180000 }
        );

        ctx.reply(`VERONICA DEPLOY COMPLETE\n\n${output.slice(0, 3500)}`);
    } catch (error: any) {
        ctx.reply(`VERONICA DEPLOY FAILED\n\nStarting automatic rollback for ${repo}...`);

        try {
            const rollbackOutput = execSync(
                `cd ${allowedRepos[repo]} && PREVIOUS=$(cat /opt/veronica/state/${repo}.previous) && git reset --hard $PREVIOUS && docker compose up -d --build && /opt/veronica/scripts/check-saasolution.sh`,
                { encoding: "utf-8", timeout: 180000 }
            );

            ctx.reply(`VERONICA AUTO-ROLLBACK COMPLETE\n\n${rollbackOutput.slice(0, 3500)}`);
        } catch (rollbackError: any) {
            ctx.reply(`VERONICA CRITICAL ERROR\n\nDeploy failed and rollback also failed.\n\n${rollbackError.message}`);
        }
    }
});

bot.command("rollback", async (ctx) => {
    if (!isAuthorized(ctx)) return ctx.reply("Unauthorized.");

    const parts = ctx.message.text.split(" ");
    const repo = parts[1];

    if (!repo || !allowedRepos[repo]) {
        return ctx.reply(`Allowed repositories:\n\n${Object.keys(allowedRepos).join("\n")}`);
    }

    try {
        ctx.reply(`VERONICA\n\nRolling back ${repo}...`);

        const output = execSync(
            `cd ${allowedRepos[repo]} && PREVIOUS=$(cat /opt/veronica/state/${repo}.previous) && git reset --hard $PREVIOUS && docker compose up -d --build && /opt/veronica/scripts/check-saasolution.sh`,
            { encoding: "utf-8", timeout: 180000 }
        );

        ctx.reply(`VERONICA ROLLBACK COMPLETE\n\n${output.slice(0, 3500)}`);
    } catch (error: any) {
        ctx.reply(`VERONICA ROLLBACK ERROR\n\n${error.message}`);
    }
});

bot.command("backup", async (ctx) => {

    if (!isAuthorized(ctx)) {
        return ctx.reply("Unauthorized.");
    }

    try {

        ctx.reply(`
VERONICA

Starting VPS backup...
`);

        const output = execSync(
            `sudo /opt/backups/scripts/vps-backup.sh`,
            { encoding: "utf-8", timeout: 300000 }
        );

        ctx.reply(`
VERONICA BACKUP COMPLETE

${output.slice(0, 3500)}
`);

    } catch (error: any) {

        ctx.reply(`
VERONICA BACKUP ERROR

${error.message}
`);
    }
});

bot.command("security", async (ctx) => {
    if (!isAuthorized(ctx)) return ctx.reply("Unauthorized.");

    try {
        const output = execSync(`
echo "UFW STATUS:"
sudo ufw status numbered

echo ""
echo "FAIL2BAN STATUS:"
sudo fail2ban-client status

echo ""
echo "SSH FAIL2BAN:"
sudo fail2ban-client status sshd

echo ""
echo "PUBLIC LISTENING PORTS:"
sudo ss -tulpn | grep LISTEN

echo ""
echo "TAILSCALE STATUS:"
tailscale status
        `, { encoding: "utf-8", timeout: 30000 });

        ctx.reply(`VERONICA SECURITY REPORT\n\n${output.slice(0, 3900)}`);
    } catch (error: any) {
        ctx.reply(`VERONICA SECURITY ERROR\n\n${error.message}`);
    }
});

bot.command("metrics", async (ctx) => {
    if (!isAuthorized(ctx)) return ctx.reply("Unauthorized.");

    try {
        const prometheusUrl = "http://127.0.0.1:9090";

        const cpuQuery = await axios.get(`${prometheusUrl}/api/v1/query`, {
            params: {
                query: `100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`
            }
        });

        const ramQuery = await axios.get(`${prometheusUrl}/api/v1/query`, {
            params: {
                query: `(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100`
            }
        });

        const diskQuery = await axios.get(`${prometheusUrl}/api/v1/query`, {
            params: {
                query: `100 - ((node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs"} * 100) / node_filesystem_size_bytes{mountpoint="/",fstype!="rootfs"})`
            }
        });

        const cpu = Number(cpuQuery.data.data.result[0]?.value[1] || 0).toFixed(1);
        const ram = Number(ramQuery.data.data.result[0]?.value[1] || 0).toFixed(1);
        const disk = Number(diskQuery.data.data.result[0]?.value[1] || 0).toFixed(1);

        ctx.reply(`
VERONICA PROMETHEUS METRICS

CPU Usage: ${cpu}%
RAM Usage: ${ram}%
Disk Usage: ${disk}%

Source: Prometheus
`);
    } catch (error: any) {
        ctx.reply(`
VERONICA METRICS ERROR

${error.message}
`);
    }
});

async function infrastructureWatchdog() {

    const TELEGRAM_CHAT_ID = AUTHORIZED_USER;

    setInterval(async () => {

        try {

            const prometheusUrl = "http://127.0.0.1:9090";

            const cpuQuery = await axios.get(`${prometheusUrl}/api/v1/query`, {
                params: {
                    query: `100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`
                }
            });

            const ramQuery = await axios.get(`${prometheusUrl}/api/v1/query`, {
                params: {
                    query: `(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100`
                }
            });

            const diskQuery = await axios.get(`${prometheusUrl}/api/v1/query`, {
                params: {
                    query: `100 - ((node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs"} * 100) / node_filesystem_size_bytes{mountpoint="/",fstype!="rootfs"})`
                }
            });

            const cpu = Number(cpuQuery.data.data.result[0]?.value[1] || 0);
            const ram = Number(ramQuery.data.data.result[0]?.value[1] || 0);
            const disk = Number(diskQuery.data.data.result[0]?.value[1] || 0);

            if (cpu > 85) {
                bot.telegram.sendMessage(
                    TELEGRAM_CHAT_ID!,
                    `VERONICA ALERT\n\nHigh CPU usage detected.\nCPU: ${cpu.toFixed(1)}%`
                );
            }

            if (ram > 85) {
                bot.telegram.sendMessage(
                    TELEGRAM_CHAT_ID!,
                    `VERONICA ALERT\n\nHigh RAM usage detected.\nRAM: ${ram.toFixed(1)}%`
                );
            }

            if (disk > 90) {
                bot.telegram.sendMessage(
                    TELEGRAM_CHAT_ID!,
                    `VERONICA ALERT\n\nDisk usage critical.\nDisk: ${disk.toFixed(1)}%`
                );
            }

        } catch (error) {

            bot.telegram.sendMessage(
                TELEGRAM_CHAT_ID!,
                `VERONICA ALERT\n\nInfrastructure watchdog failed.\nPrometheus may be unreachable.`
            );
        }

    }, 300000);
}

startWatchdog();

infrastructureWatchdog();

bot.command("ai", async (ctx) => {
    if (!isAuthorized(ctx)) {
        return ctx.reply("Unauthorized.");
    }

    const userPrompt = ctx.message.text.replace("/ai", "").trim();

    if (!userPrompt) {
        return ctx.reply("Usage:\n\n/ai check my Docker setup");
    }

    await ctx.reply("VERONICA AI\n\nAnalyzing live VPS context...");

    try {
        const dockerContainers = execSync(
            `docker ps --format "{{.Names}} ({{.Status}})"`,
            { encoding: "utf-8" }
        );

        const systemInfo = await getHealthReport();

        const aiPrompt = `
You are Veronica, an advanced AI infrastructure operator.

You are running INSIDE the user's VPS.

LIVE INFRASTRUCTURE:

Docker containers currently running:
${dockerContainers}

Current server health:
CPU Load: ${systemInfo.cpu.toFixed(1)}%
RAM Used: ${systemInfo.ramUsed.toFixed(2)} GB
RAM Total: ${systemInfo.ramTotal.toFixed(2)} GB
Disk Usage: ${systemInfo.diskUsed.toFixed(1)}%

Capabilities:
- Monitor Docker
- Analyze logs
- Monitor Mailcow
- Monitor Grafana
- Monitor Prometheus
- Monitor Nginx Proxy Manager
- Suggest infrastructure improvements
- Suggest safe fixes
- Explain issues

Rules:
- NEVER invent fake information.
- ONLY discuss infrastructure actually detected.
- Prefer safe actions.
- Dangerous actions require approval.
- Be concise and operational.
- Speak like an AI systems operator.

USER REQUEST:
${userPrompt}
`;

        const response = await axios.post(`${process.env.OLLAMA_HOST}/api/generate`, {
            model: process.env.OLLAMA_MODEL,
            prompt: aiPrompt,
            stream: false
        });

        const answer = response.data.response || "No response from AI.";
        await ctx.reply(answer.slice(0, 3500));

    } catch (error: any) {
        await ctx.reply(`VERONICA AI ERROR\n\n${error.message}`);
    }
});

bot.command("diagnose", async (ctx) => {
    if (!isAuthorized(ctx)) {
        return ctx.reply("Unauthorized.");
    }

    const target = ctx.message.text.replace("/diagnose", "").trim();

    if (!target) {
        return ctx.reply("Usage:\n\n/diagnose mailcow\n/diagnose grafana\n/diagnose docker");
    }

    await ctx.reply(`VERONICA DIAGNOSTIC\n\nChecking: ${target}`);

    try {
        const dockerContainers = getDockerContainers();
        const dockerHealthSummary = getDockerHealthSummary();
        const systemInfo = await getSystemHealth();

        let logs = "";

        if (target.toLowerCase().includes("grafana")) {
            logs = execSync("docker logs --tail 80 grafana", { encoding: "utf-8" });
        }

        if (target.toLowerCase().includes("prometheus")) {
            logs = execSync("docker logs --tail 80 prometheus", { encoding: "utf-8" });
        }

        if (target.toLowerCase().includes("saasolution")) {
            logs = execSync("docker logs --tail 80 saasolution", { encoding: "utf-8" });
        }

        if (target.toLowerCase().includes("mailcow")) {
            const mailcowStatus = execSync(
    "docker ps --format '{{.Names}} | {{.Status}}' | grep mailcow",
    { encoding: "utf-8" }
);

const watchdogLogs = execSync(
    "docker logs --tail 120 mailcowdockerized-watchdog-mailcow-1 2>&1",
    { encoding: "utf-8" }
);

logs = `
MAILCOW CONTAINER STATUS:
${mailcowStatus}

WATCHDOG LOGS:
${watchdogLogs}
`;
        }

        const aiPrompt = `
You are Veronica, an AI infrastructure operator.

Task:
Diagnose this target: ${target}

Live system health:
CPU: ${systemInfo.cpu.toFixed(1)}%
RAM: ${systemInfo.ramUsedGb.toFixed(2)} / ${systemInfo.ramTotalGb.toFixed(2)} GB
Disk: ${systemInfo.diskUsedPercent.toFixed(1)}%
Uptime: ${systemInfo.uptimeHours} hours

Running containers:
${dockerContainers}

Relevant logs/status:
${logs || "No specific logs collected."}

Answer format:
1. Status
2. What I found
3. Likely issue, if any
4. Safe action I can take now
5. Risky action requiring approval

Be specific. Do not give generic Docker advice.
`;

        const response = await axios.post(`${process.env.OLLAMA_HOST}/api/generate`, {
            model: process.env.OLLAMA_MODEL,
            prompt: aiPrompt,
            stream: false
        });

        await ctx.reply((response.data.response || "No AI response.").slice(0, 3500));

    } catch (error: any) {
        await ctx.reply(`VERONICA DIAGNOSTIC ERROR\n\n${error.message}`);
    }
});

bot.on("text", async (ctx) => {

    if (!isAuthorized(ctx)) {
        return ctx.reply("Unauthorized.");
    }

    const message = ctx.message.text;

    // Ignore slash commands
    if (message.startsWith("/")) {
        return;
    }

    await ctx.reply("VERONICA\n\nAnalyzing infrastructure...");

    try {

        const response = await askVeronica(message);

        let reply = "No response from Veronica.";

        if (typeof response.content === "string") {
            reply = response.content;
        }

        await ctx.reply(reply.slice(0, 3500));

    } catch (error: any) {

        await ctx.reply(`VERONICA ERROR\n\n${error.message}`);
    }
});

bot.launch();

console.log("VERONICA ONLINE");

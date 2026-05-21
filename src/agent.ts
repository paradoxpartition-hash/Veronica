import { ChatOllama } from "@langchain/ollama";

import {
    getDockerContainers,
    getDockerHealthSummary,
    getContainerLogs
} from "./tools/docker";

import { getSystemHealth } from "./tools/system";
import { setMemory, getMemory } from "./memory";

const model = new ChatOllama({
    baseUrl: process.env.OLLAMA_HOST,
    model: process.env.OLLAMA_MODEL,
    temperature: 0.1
});

export async function askVeronica(message: string) {

    const lastTopic = await getMemory("last_topic");

    const systemHealth = await getSystemHealth();
    const dockerHealth = getDockerHealthSummary();
    const dockerContainers = getDockerContainers();

    let extraLogs = "";

    const lowerMessage = message.toLowerCase();
    const lastTopicText = String(lastTopic || "").toLowerCase();

    if (
        lowerMessage.includes("watchdog") ||
        lowerMessage.includes("mailcow") ||
        lowerMessage.includes("logs") ||
        lowerMessage.includes("check it") ||
        lowerMessage.includes("go deeper") ||
        lowerMessage.includes("what exactly") ||
        lastTopicText.includes("mailcow") ||
        lastTopicText.includes("watchdog")
    ) {
        extraLogs = getContainerLogs("mailcowdockerized-watchdog-mailcow-1", 120);
    }

    const prompt = `
You are Veronica, Othman's AI infrastructure operator.

The user asked:
${message}

Previous topic:
${lastTopic || "None"}

LIVE SYSTEM HEALTH:
CPU: ${systemHealth.cpu.toFixed(1)}%
RAM: ${systemHealth.ramUsedGb.toFixed(2)} / ${systemHealth.ramTotalGb.toFixed(2)} GB
Disk: ${systemHealth.diskUsedPercent.toFixed(1)}%
Uptime: ${systemHealth.uptimeHours} hours

DOCKER HEALTH SUMMARY:
${dockerHealth}

RUNNING CONTAINERS:
${dockerContainers}

RELEVANT CONTAINER LOGS:
${extraLogs || "No extra logs collected."}

Critical interpretation rules:
- If Docker status says only "Up X hours" and does NOT contain "(unhealthy)", "Exited", "Restarting", or "Dead", then the container is healthy/running.
- Do NOT mark a service Warning or Critical just because it has long uptime.
- Long uptime usually means stability.
- If Docker status text contains "(unhealthy)", then mark the verdict as Warning or Critical depending on the affected service.
- If logs are provided, analyze the actual log content.
- Do NOT claim the logs show something unless it appears in RELEVANT CONTAINER LOGS.

General rules:
- Do NOT output JSON.
- Do NOT mention tool calls.
- Do NOT ask the user to run commands.
- Use only the live context above.
- Never invent per-container CPU/RAM.
- Docker "Up X hours" means running, not unhealthy.
- Only call a container unhealthy if the Docker status text literally contains:
  "(unhealthy)"
  "Exited"
  "Restarting"
  "Dead"
- Lowercase words like "unhealthy" inside these instructions do NOT count as evidence.
- Evidence must come from the LIVE Docker status/context above.
- CPU below 70% is normal.
- RAM below 80% is normal.
- Disk below 80% is normal.
- Dangerous actions require approval.
- Health verdict MUST be exactly one of:
  Healthy
  Warning
  Critical
  Unknown
- Never use "None detected" as the health verdict.
- If all containers are healthy/running, the Health verdict MUST be "Healthy".
- A healthy container can NEVER produce a "Critical" verdict.
- If Explicit unhealthy container/service says "None detected", the verdict cannot be Critical.
- If a container is unhealthy, Safe next action should usually be checking its logs.
- Never answer "None detected" for Safe next action.
- If the user asks short follow-up questions like:
  "what?"
  "why?"
  "fix it"
  "do it"
  "check it"
  "what exactly?"
  then assume they refer to the Previous topic.

Answer format:
1. Health verdict
2. Explicit unhealthy container/service: only name a service if Docker status literally contains "(unhealthy)", "Exited", "Restarting", or "Dead"; otherwise say "None detected"
3. Evidence from live context
4. Safe next action: always give one concrete read-only check
5. Action requiring approval: always say what action needs approval, or say "None required"
`;

    const response = await model.invoke([
        {
            role: "user",
            content: prompt
        }
    ]);

    await setMemory("last_topic", message);

    return response;
}

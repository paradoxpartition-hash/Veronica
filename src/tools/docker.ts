import { execSync } from "child_process";

export function getDockerContainers(): string {
    return execSync(
        `docker ps --format "• {{.Names}} | {{.Status}} | {{.Image}}"`,
        { encoding: "utf-8" }
    );
}

export function getContainerLogs(containerName: string, lines = 80): string {
    return execSync(
        `docker logs --tail ${lines} ${containerName}`,
        { encoding: "utf-8" }
    );
}

export function restartContainer(containerName: string): string {
    return execSync(
        `docker restart ${containerName}`,
        { encoding: "utf-8" }
    );
}

export function getDockerHealthSummary(): string {
    return execSync(
        `docker ps -a --format "• {{.Names}} | {{.Status}} | {{.Image}}"`,
        { encoding: "utf-8" }
    );
}

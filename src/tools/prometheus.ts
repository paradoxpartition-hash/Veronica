import { execSync } from "child_process";

export function checkPrometheusHealth(): string {
    try {
        return execSync("curl -s --max-time 5 http://prometheus:9090/-/healthy || curl -s --max-time 5 http://127.0.0.1:9090/-/healthy", {
            encoding: "utf-8"
        });
    } catch (error: any) {
        return `PROMETHEUS_UNREACHABLE: ${error.message}`;
    }
}

export function restartPrometheus(): string {
    return execSync("docker restart prometheus", {
        encoding: "utf-8"
    });
}

export function getPrometheusLogs(): string {
    return execSync("docker logs --tail 120 prometheus 2>&1", {
        encoding: "utf-8"
    });
}


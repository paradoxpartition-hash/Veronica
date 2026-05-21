import si from "systeminformation";

export async function getSystemHealth() {
    const load = await si.currentLoad();
    const mem = await si.mem();
    const fs = await si.fsSize();
    const time = await si.time();

    return {
        cpu: load.currentLoad,
        ramUsedGb: mem.used / 1024 / 1024 / 1024,
        ramTotalGb: mem.total / 1024 / 1024 / 1024,
        diskUsedPercent: fs[0]?.use ?? 0,
        uptimeHours: Math.floor(time.uptime / 3600)
    };
}

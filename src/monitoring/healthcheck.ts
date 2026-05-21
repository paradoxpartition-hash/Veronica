import si from "systeminformation";

export async function getHealthReport() {

    const load = await si.currentLoad();
    const mem = await si.mem();
    const fs = await si.fsSize();

    return {
        cpu: load.currentLoad,
        ramUsed: mem.used / 1024 / 1024 / 1024,
        ramTotal: mem.total / 1024 / 1024 / 1024,
        diskUsed: fs[0].use
    };
}

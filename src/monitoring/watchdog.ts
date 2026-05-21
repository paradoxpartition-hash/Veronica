import cron from "node-cron";
import { getHealthReport } from "./healthcheck";

export function startWatchdog(bot: any, userId: string) {

    cron.schedule("*/5 * * * *", async () => {

        const report = await getHealthReport();

        if (report.cpu > 85) {
            bot.telegram.sendMessage(userId,
                `⚠️ VERONICA ALERT\n\nHigh CPU usage detected: ${report.cpu.toFixed(1)}%`
            );
        }

        if ((report.ramUsed / report.ramTotal) * 100 > 90) {
            bot.telegram.sendMessage(userId,
                `⚠️ VERONICA ALERT\n\nHigh RAM usage detected`
            );
        }

        if (report.diskUsed > 90) {
            bot.telegram.sendMessage(userId,
                `⚠️ VERONICA ALERT\n\nDisk usage critical: ${report.diskUsed.toFixed(1)}%`
            );
        }

    });

    console.log("VERONICA WATCHDOG ACTIVE");
}

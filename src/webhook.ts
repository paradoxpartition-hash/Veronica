import dotenv from "dotenv";
dotenv.config();

import express from "express";
import bodyParser from "body-parser";
import { execSync } from "child_process";
import axios from "axios";
import crypto from "crypto";

const app = express();

app.use(
    bodyParser.json({
        verify: (req: any, _res, buf) => {
            req.rawBody = buf;
        }
    })
);

const PORT = 4000;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AUTHORIZED_USER_ID = process.env.AUTHORIZED_USER_ID;
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

const allowedRepos: Record<string, string> = {
    "SaaSolution": "/opt/projects/apps/SaaSolution"
};

async function notifyTelegram(message: string) {
    if (!TELEGRAM_BOT_TOKEN || !AUTHORIZED_USER_ID) return;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: AUTHORIZED_USER_ID,
        text: message
    });
}

function verifyGitHubSignature(req: any): boolean {
    if (!GITHUB_WEBHOOK_SECRET) return false;

    const signature = req.headers["x-hub-signature-256"];
    if (!signature || !req.rawBody) return false;

    const expectedSignature =
        "sha256=" +
        crypto
            .createHmac("sha256", GITHUB_WEBHOOK_SECRET)
            .update(req.rawBody)
            .digest("hex");

    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
}

app.post("/github-webhook", async (req: any, res) => {
    const repoName = req.body.repository?.name;
    const branch = req.body.ref?.replace("refs/heads/", "");
    const commit = req.body.after?.substring(0, 7);

    try {
        if (!verifyGitHubSignature(req)) {
            await notifyTelegram(`VERONICA SECURITY ALERT\n\nInvalid GitHub webhook signature rejected.`);
            return res.status(401).send("Invalid signature");
        }

        if (!allowedRepos[repoName]) {
            return res.status(403).send("Repository not allowed");
        }

        await notifyTelegram(
            `VERONICA AUTO-DEPLOY STARTED\n\nRepo: ${repoName}\nBranch: ${branch}\nCommit: ${commit}`
        );

        const output = execSync(
            `cd ${allowedRepos[repoName]} && git rev-parse HEAD > /opt/veronica/state/${repoName}.previous && git pull && docker compose up -d --build && /opt/veronica/scripts/check-saasolution.sh`,
            { encoding: "utf-8", timeout: 180000 }
        );

        await notifyTelegram(
            `VERONICA AUTO-DEPLOY COMPLETE\n\nRepo: ${repoName}\nCommit: ${commit}\n\n${output.slice(-1200)}`
        );

        res.status(200).send("Deployment successful");
    } catch (error: any) {
        await notifyTelegram(
            `VERONICA AUTO-DEPLOY FAILED\n\nRepo: ${repoName}\nCommit: ${commit}\n\n${error.message}`
        );

        res.status(500).send("Deployment failed");
    }
});

app.listen(PORT, () => {
    console.log(`VERONICA WEBHOOK SERVER ACTIVE ON PORT ${PORT}`);
});

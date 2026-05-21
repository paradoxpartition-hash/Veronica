import dotenv from 'dotenv';
dotenv.config();

import { Telegraf } from 'telegraf';
import { processMessage } from './agent';
import { handleApprovalCallback } from './approvals';
import { startWatchdog } from './monitoring/watchdog';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const AUTHORIZED_USER = process.env.AUTHORIZED_USER_ID!;

function isAuthorized(userId: number | undefined): boolean {
  return String(userId) === AUTHORIZED_USER;
}

bot.start((ctx) => {
  if (!isAuthorized(ctx.from?.id)) {
    return ctx.reply(`Unauthorized.\n\nYour Telegram ID: ${ctx.from?.id}`);
  }
  ctx.reply(
    `*V.E.R.O.N.I.C.A. ONLINE*\n\nVariable Emergency Response Organic Network Integrated Combat Armor\n\nTalk to me naturally — no slash commands needed.\nExample: _"Veronica, Prometheus is unreachable. Fix what you safely can."_`,
    { parse_mode: 'Markdown' }
  );
});

bot.on('callback_query', async (ctx) => {
  const cq = ctx.callbackQuery as any;
  if (!isAuthorized(cq.from?.id)) return;
  await handleApprovalCallback(bot, cq);
});

bot.on('text', async (ctx) => {
  if (!isAuthorized(ctx.from?.id)) {
    return ctx.reply(`Unauthorized. Your Telegram ID: ${ctx.from?.id}`);
  }

  const message = ctx.message.text;
  if (message.startsWith('/')) return;

  const typing = ctx.reply('_Analyzing..._', { parse_mode: 'Markdown' });

  try {
    const [, response] = await Promise.all([
      typing,
      processMessage(message, AUTHORIZED_USER, bot),
    ]);
    await ctx.reply(response);
  } catch (err: any) {
    await ctx.reply(`Error: ${err.message}`);
  }
});

if (AUTHORIZED_USER) {
  startWatchdog(bot, AUTHORIZED_USER);
}

bot.launch().then(() => {
  console.log('VERONICA ONLINE');
  if (AUTHORIZED_USER) {
    bot.telegram.sendMessage(
      AUTHORIZED_USER,
      `*V.E.R.O.N.I.C.A. ONLINE* ✅\n\nSystems restored. Watchdog active. Ready.`,
      { parse_mode: 'Markdown' }
    ).catch((err) => console.error('Startup notify failed:', err.message));
  }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

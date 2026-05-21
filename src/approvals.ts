import { Telegraf } from 'telegraf';
import crypto from 'crypto';
import { redis } from './memory';

export interface PendingActionRecord {
  id: string;
  actionType: string;
  description: string;
  userId: string;
  createdAt: number;
}

// Executors live in memory only — functions can't be serialized to Redis.
// 5-minute TTL on Redis record matches reasonable approval window.
const pendingExecutors = new Map<string, () => Promise<string>>();

export async function requestApproval(
  bot: Telegraf,
  userId: string,
  actionType: string,
  description: string,
  executor: () => Promise<string>
): Promise<void> {
  const id = crypto.randomUUID();

  const record: PendingActionRecord = {
    id,
    actionType,
    description,
    userId,
    createdAt: Date.now(),
  };

  await redis.set(`pending_approval:${id}`, JSON.stringify(record), 'EX', 300);
  pendingExecutors.set(id, executor);

  await bot.telegram.sendMessage(
    userId,
    `⚠️ *APPROVAL REQUIRED*\n\n*Action:* \`${actionType}\`\n*Details:* ${description}\n\n_Expires in 5 minutes._`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Approve', callback_data: `approve:${id}` },
          { text: '❌ Reject', callback_data: `reject:${id}` },
        ]],
      },
    }
  );
}

export async function handleApprovalCallback(
  bot: Telegraf,
  callbackQuery: any
): Promise<void> {
  const data: string = callbackQuery.data || '';
  const userId = String(callbackQuery.from?.id);
  const chatId = callbackQuery.message?.chat?.id;
  const messageId = callbackQuery.message?.message_id;

  if (!data.startsWith('approve:') && !data.startsWith('reject:')) return;

  const colonIdx = data.indexOf(':');
  const action = data.slice(0, colonIdx);
  const id = data.slice(colonIdx + 1);

  const raw = await redis.get(`pending_approval:${id}`);
  if (!raw) {
    await bot.telegram.answerCbQuery(callbackQuery.id, '⏰ Expired or not found.');
    return;
  }

  const record: PendingActionRecord = JSON.parse(raw);
  if (record.userId !== userId) {
    await bot.telegram.answerCbQuery(callbackQuery.id, '🚫 Not authorized.');
    return;
  }

  await redis.del(`pending_approval:${id}`);

  if (action === 'approve') {
    const executor = pendingExecutors.get(id);
    pendingExecutors.delete(id);

    await bot.telegram.answerCbQuery(callbackQuery.id, '⚙️ Executing...');
    await bot.telegram.editMessageText(
      chatId, messageId, undefined,
      `✅ *Approved* — executing \`${record.actionType}\`...`,
      { parse_mode: 'Markdown' }
    );

    if (executor) {
      try {
        const result = await executor();
        await bot.telegram.sendMessage(
          userId,
          `✅ *${record.actionType}* complete\n\n${result.slice(0, 3000)}`,
          { parse_mode: 'Markdown' }
        );
      } catch (err: any) {
        await bot.telegram.sendMessage(
          userId,
          `❌ *${record.actionType}* failed\n\n${err.message}`,
          { parse_mode: 'Markdown' }
        );
      }
    } else {
      await bot.telegram.sendMessage(
        userId,
        '⚠️ Executor expired (Veronica may have restarted). Please retry.'
      );
    }
  } else {
    pendingExecutors.delete(id);
    await bot.telegram.answerCbQuery(callbackQuery.id, '❌ Rejected.');
    await bot.telegram.editMessageText(
      chatId, messageId, undefined,
      `❌ *Rejected* — \`${record.actionType}\` cancelled.`,
      { parse_mode: 'Markdown' }
    );
  }
}

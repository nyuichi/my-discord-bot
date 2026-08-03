import "dotenv/config";
import { Client, Events, GatewayIntentBits, MessageFlags, type Message } from "discord.js";
import { ColleagueAssistant } from "./assistant.js";
import { loadConfig } from "./config.js";
import { BudgetExceededError, CostGuard } from "./cost-guard.js";
import { recentChannelHistory, stripBotMention } from "./history.js";
import { hashId, Logger, safeError } from "./logger.js";
import { StateStore } from "./store.js";

const config = loadConfig();
const logger = new Logger(config.logLevel);
const store = new StateStore(config.stateFile);
await store.init();
const costGuard = new CostGuard(config, store);
const assistant = new ColleagueAssistant(config, costGuard);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

const channelQueues = new Map<string, Promise<void>>();
const lastAcceptedAt = new Map<string, number>();

function queueForChannel(channelId: string, operation: () => Promise<void>): void {
  const previous = channelQueues.get(channelId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation).finally(() => {
    if (channelQueues.get(channelId) === next) channelQueues.delete(channelId);
  });
  channelQueues.set(channelId, next);
}

function splitDiscordMessage(text: string, maximum = 1950): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maximum && chunks.length < 7) {
    let cut = remaining.lastIndexOf("\n", maximum);
    if (cut < maximum / 2) cut = remaining.lastIndexOf(" ", maximum);
    if (cut < maximum / 2) cut = maximum;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining.slice(0, maximum));
  return chunks;
}

async function sendReply(message: Message, text: string): Promise<void> {
  const chunks = splitDiscordMessage(text);
  const first = chunks.shift();
  if (!first) return;
  await message.reply({ content: first, allowedMentions: { parse: [], repliedUser: false } });
  if (!message.channel.isSendable()) return;
  for (const chunk of chunks) await message.channel.send({ content: chunk, allowedMentions: { parse: [] } });
}

async function handleMention(message: Message): Promise<void> {
  const channelHash = hashId(message.channelId);
  const userHash = hashId(message.author.id);
  const startedAt = Date.now();
  logger.info("mention.accepted", { channel: channelHash, user: userHash });

  try {
    if ("sendTyping" in message.channel) await message.channel.sendTyping();
    const [history, channelState] = await Promise.all([
      recentChannelHistory(message, config.historyMessageLimit, config.historyMaxChars),
      store.channel(message.channelId),
    ]);
    const botId = client.user?.id;
    if (!botId) return;
    // cleanContent renders mentions as display names, so remove the raw mention before Discord transforms it.
    const question = stripBotMention(message.content, botId).slice(0, 8000);
    const result = await assistant.reply({
      channelId: message.channelId,
      userId: message.author.id,
      displayName: message.member?.displayName || message.author.displayName,
      question,
      recentHistory: history,
      channelSummary: channelState.summary,
    });
    await sendReply(message, result.text);
    logger.info("mention.replied", {
      channel: channelHash,
      user: userHash,
      durationMs: Date.now() - startedAt,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedCostUsd: Number(result.costUsd.toFixed(6)),
    });

    const shouldSummarize = await store.mutate((state) => {
      const current = state.channels[message.channelId] ?? { summary: "", mentionsSinceSummary: 0, updatedAt: new Date(0).toISOString() };
      current.mentionsSinceSummary += 1;
      state.channels[message.channelId] = current;
      return current.mentionsSinceSummary >= config.summaryEveryMentions;
    });
    if (shouldSummarize) {
      try {
        const latest = await store.channel(message.channelId);
        const summarySource = `${history}\n${message.member?.displayName || message.author.displayName}: ${question.slice(0, 2000)}\nBot: ${result.text.slice(0, 4000)}`;
        const summary = await assistant.summarize(message.channelId, latest.summary, summarySource);
        if (summary.text) {
          await store.mutate((state) => {
            state.channels[message.channelId] = {
              summary: summary.text.slice(0, 8000),
              mentionsSinceSummary: 0,
              updatedAt: new Date().toISOString(),
            };
          });
        }
        logger.info("summary.updated", { channel: channelHash, outputTokens: summary.usage.outputTokens });
      } catch (error) {
        logger.warn("summary.skipped", { channel: channelHash, ...safeError(error) });
      }
    }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      const text = error.reason === "monthly_budget"
        ? "今月のBot内予算上限に達したので、管理者が設定を確認するまで返答を停止しています。"
        : "本日のAPI呼び出し上限に達しました。UTCの日付が変わると再開します。";
      await message.reply({ content: text, flags: MessageFlags.SuppressNotifications, allowedMentions: { parse: [], repliedUser: false } }).catch(() => undefined);
      logger.warn("mention.budget_blocked", { channel: channelHash, reason: error.reason });
      return;
    }
    logger.error("mention.failed", { channel: channelHash, user: userHash, ...safeError(error) });
    await message.reply({
      content: "いま返答を作れませんでした。少し待ってからもう一度メンションしてください。",
      flags: MessageFlags.SuppressNotifications,
      allowedMentions: { parse: [], repliedUser: false },
    }).catch(() => undefined);
  }
}

client.once(Events.ClientReady, (readyClient) => {
  logger.info("bot.ready", { bot: hashId(readyClient.user.id), model: config.openaiModel });
});

client.on(Events.MessageCreate, (message) => {
  if (!client.user || !message.inGuild() || message.author.bot) return;
  if (!message.mentions.users.has(client.user.id)) return;
  if (config.allowedChannelIds.size > 0 && !config.allowedChannelIds.has(message.channelId)) return;

  const previous = lastAcceptedAt.get(message.channelId) ?? 0;
  if (Date.now() - previous < config.channelCooldownMs) {
    logger.debug("mention.cooldown", { channel: hashId(message.channelId) });
    return;
  }
  lastAcceptedAt.set(message.channelId, Date.now());
  queueForChannel(message.channelId, () => handleMention(message));
});

process.on("unhandledRejection", (error) => {
  logger.error("process.unhandled_rejection", safeError(error));
  process.exit(1);
});
process.on("uncaughtException", (error) => {
  logger.error("process.uncaught_exception", safeError(error));
  process.exit(1);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    logger.info("bot.shutdown", { signal });
    client.destroy();
    process.exit(0);
  });
}

await client.login(config.discordToken);

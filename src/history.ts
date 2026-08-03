import type { Message } from "discord.js";

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function renderMessage(message: Message): string {
  const text = oneLine(message.cleanContent || "").slice(0, 1600);
  const attachments = [...message.attachments.values()]
    .slice(0, 3)
    .map((attachment) => `[attachment: ${oneLine(attachment.name || "file").slice(0, 100)}]`)
    .join(" ");
  return `${oneLine(message.author.displayName).slice(0, 80)}: ${[text, attachments].filter(Boolean).join(" ") || "[no text]"}`;
}

export async function recentChannelHistory(
  message: Message,
  limit: number,
  maxCharacters: number,
): Promise<string> {
  if (limit === 0 || !message.channel.isTextBased() || !("messages" in message.channel)) return "";
  const fetched = await message.channel.messages.fetch({ limit, before: message.id });
  const lines = [...fetched.values()]
    .filter((item) => !item.system)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(renderMessage);

  const selected: string[] = [];
  let size = 0;
  for (const line of lines.reverse()) {
    if (size + line.length + 1 > maxCharacters) break;
    selected.push(line);
    size += line.length + 1;
  }
  return selected.reverse().join("\n");
}

export function stripBotMention(content: string, botId: string): string {
  return content.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
}

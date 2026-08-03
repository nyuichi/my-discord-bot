export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export interface Config {
  discordToken: string;
  openaiApiKey: string;
  openaiModel: string;
  reasoningEffort: ReasoningEffort;
  maxOutputTokens: number;
  historyMessageLimit: number;
  historyMaxChars: number;
  summaryEveryMentions: number;
  summaryMaxTokens: number;
  monthlyBudgetUsd: number;
  maxDailyApiCalls: number;
  inputPrice: number;
  cachedInputPrice: number;
  cacheWritePrice: number;
  outputPrice: number;
  channelCooldownMs: number;
  allowedChannelIds: ReadonlySet<string>;
  stateFile: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const value = numberEnv(name, fallback, min, max);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

export function loadConfig(): Config {
  const effort = (process.env.OPENAI_REASONING_EFFORT?.trim() || "medium") as ReasoningEffort;
  if (!["none", "low", "medium", "high", "xhigh", "max"].includes(effort)) {
    throw new Error("OPENAI_REASONING_EFFORT is invalid");
  }

  const logLevel = (process.env.LOG_LEVEL?.trim() || "info") as Config["logLevel"];
  if (!["debug", "info", "warn", "error"].includes(logLevel)) {
    throw new Error("LOG_LEVEL is invalid");
  }

  return {
    discordToken: required("DISCORD_TOKEN"),
    openaiApiKey: required("OPENAI_API_KEY"),
    openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-5.6",
    reasoningEffort: effort,
    maxOutputTokens: integerEnv("MAX_OUTPUT_TOKENS", 2000, 128, 16000),
    historyMessageLimit: integerEnv("HISTORY_MESSAGE_LIMIT", 30, 0, 100),
    historyMaxChars: integerEnv("HISTORY_MAX_CHARS", 12000, 1000, 100000),
    summaryEveryMentions: integerEnv("SUMMARY_EVERY_MENTIONS", 8, 1, 1000),
    summaryMaxTokens: integerEnv("SUMMARY_MAX_TOKENS", 600, 128, 4000),
    monthlyBudgetUsd: numberEnv("MONTHLY_BUDGET_USD", 20, 0.01, 100000),
    maxDailyApiCalls: integerEnv("MAX_DAILY_API_CALLS", 80, 1, 100000),
    inputPrice: numberEnv("PRICE_INPUT_PER_MILLION_USD", 5, 0, 10000),
    cachedInputPrice: numberEnv("PRICE_CACHED_INPUT_PER_MILLION_USD", 0.5, 0, 10000),
    cacheWritePrice: numberEnv("PRICE_CACHE_WRITE_PER_MILLION_USD", 6.25, 0, 10000),
    outputPrice: numberEnv("PRICE_OUTPUT_PER_MILLION_USD", 30, 0, 10000),
    channelCooldownMs: integerEnv("CHANNEL_COOLDOWN_SECONDS", 5, 0, 3600) * 1000,
    allowedChannelIds: new Set(
      (process.env.ALLOWED_CHANNEL_IDS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    stateFile: process.env.STATE_FILE?.trim() || "./data/state.json",
    logLevel,
  };
}

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface UsageBucket {
  requests: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface ChannelState {
  summary: string;
  mentionsSinceSummary: number;
  updatedAt: string;
}

export interface BotState {
  version: 1;
  channels: Record<string, ChannelState>;
  monthlyUsage: Record<string, UsageBucket>;
  dailyCalls: Record<string, number>;
}

function initialState(): BotState {
  return { version: 1, channels: {}, monthlyUsage: {}, dailyCalls: {} };
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeState(value: unknown): BotState {
  if (!value || typeof value !== "object") throw new Error("Unsupported state file");
  const source = value as Record<string, unknown>;
  if (source.version !== 1) throw new Error("Unsupported state file");

  const state = initialState();
  if (source.channels && typeof source.channels === "object") {
    for (const [channelId, raw] of Object.entries(source.channels)) {
      if (!/^\d{1,32}$/.test(channelId) || !raw || typeof raw !== "object") continue;
      const channel = raw as Record<string, unknown>;
      state.channels[channelId] = {
        summary: typeof channel.summary === "string" ? channel.summary.slice(0, 8000) : "",
        mentionsSinceSummary: Math.floor(finiteNonNegative(channel.mentionsSinceSummary)),
        updatedAt: typeof channel.updatedAt === "string" ? channel.updatedAt : new Date(0).toISOString(),
      };
    }
  }
  if (source.monthlyUsage && typeof source.monthlyUsage === "object") {
    for (const [month, raw] of Object.entries(source.monthlyUsage)) {
      if (!/^\d{4}-\d{2}$/.test(month) || !raw || typeof raw !== "object") continue;
      const usage = raw as Record<string, unknown>;
      state.monthlyUsage[month] = {
        requests: Math.floor(finiteNonNegative(usage.requests)),
        inputTokens: Math.floor(finiteNonNegative(usage.inputTokens)),
        cachedInputTokens: Math.floor(finiteNonNegative(usage.cachedInputTokens)),
        cacheWriteTokens: Math.floor(finiteNonNegative(usage.cacheWriteTokens)),
        outputTokens: Math.floor(finiteNonNegative(usage.outputTokens)),
        estimatedCostUsd: finiteNonNegative(usage.estimatedCostUsd),
      };
    }
  }
  if (source.dailyCalls && typeof source.dailyCalls === "object") {
    for (const [day, calls] of Object.entries(source.dailyCalls)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) state.dailyCalls[day] = Math.floor(finiteNonNegative(calls));
    }
  }
  return state;
}

export class StateStore {
  private state: BotState = initialState();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      this.state = normalizeState(JSON.parse(await readFile(this.filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.save();
    }
  }

  async mutate<T>(operation: (state: BotState) => T | Promise<T>): Promise<T> {
    let result!: T;
    let failure: unknown;
    this.queue = this.queue.then(async () => {
      try {
        result = await operation(this.state);
        await this.save();
      } catch (error) {
        failure = error;
      }
    });
    await this.queue;
    if (failure) throw failure;
    return result;
  }

  async channel(channelId: string): Promise<Readonly<ChannelState>> {
    return this.mutate((state) => {
      const existing = state.channels[channelId];
      if (existing) return { ...existing };
      const created = { summary: "", mentionsSinceSummary: 0, updatedAt: new Date(0).toISOString() };
      state.channels[channelId] = created;
      return { ...created };
    });
  }

  private async save(): Promise<void> {
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}

export function emptyUsageBucket(): UsageBucket {
  return {
    requests: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };
}

import type { Config } from "./config.js";
import { emptyUsageBucket, type StateStore } from "./store.js";

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export interface Reservation {
  month: string;
  reservedUsd: number;
}

export class BudgetExceededError extends Error {
  constructor(public readonly reason: "monthly_budget" | "daily_calls") {
    super(reason);
    this.name = "BudgetExceededError";
  }
}

function monthKey(now: Date): string { return now.toISOString().slice(0, 7); }
function dayKey(now: Date): string { return now.toISOString().slice(0, 10); }

export class CostGuard {
  constructor(private readonly config: Config, private readonly store: StateStore) {}

  async reserve(inputBytes: number, maxOutputTokens: number, now = new Date()): Promise<Reservation> {
    // One token cannot encode more input than the underlying UTF-8 byte stream. Reserving one token per
    // byte, plus overhead for API formatting, deliberately overestimates ASCII and remains safe for Japanese.
    const estimatedInputTokens = Math.ceil(inputBytes) + 1500;
    const reservedUsd = this.cost({
      inputTokens: estimatedInputTokens,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: maxOutputTokens,
    });
    const month = monthKey(now);
    const day = dayKey(now);

    await this.store.mutate((state) => {
      const calls = state.dailyCalls[day] ?? 0;
      if (calls >= this.config.maxDailyApiCalls) throw new BudgetExceededError("daily_calls");
      const usage = state.monthlyUsage[month] ?? emptyUsageBucket();
      if (usage.estimatedCostUsd + reservedUsd > this.config.monthlyBudgetUsd) {
        throw new BudgetExceededError("monthly_budget");
      }
      usage.requests += 1;
      usage.estimatedCostUsd += reservedUsd;
      state.monthlyUsage[month] = usage;
      state.dailyCalls[day] = calls + 1;
    });

    return { month, reservedUsd };
  }

  async settle(reservation: Reservation, usage: TokenUsage): Promise<number> {
    const actualUsd = this.cost(usage);
    await this.store.mutate((state) => {
      const bucket = state.monthlyUsage[reservation.month] ?? emptyUsageBucket();
      bucket.inputTokens += usage.inputTokens;
      bucket.cachedInputTokens += usage.cachedInputTokens;
      bucket.cacheWriteTokens += usage.cacheWriteTokens;
      bucket.outputTokens += usage.outputTokens;
      bucket.estimatedCostUsd = Math.max(0, bucket.estimatedCostUsd - reservation.reservedUsd + actualUsd);
      state.monthlyUsage[reservation.month] = bucket;
    });
    return actualUsd;
  }

  // A failed request keeps the conservative reservation. This is safer than undercounting after an ambiguous network failure.
  cost(usage: TokenUsage): number {
    const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens);
    return (
      uncached * this.config.inputPrice +
      usage.cachedInputTokens * this.config.cachedInputPrice +
      usage.cacheWriteTokens * this.config.cacheWritePrice +
      usage.outputTokens * this.config.outputPrice
    ) / 1_000_000;
  }
}

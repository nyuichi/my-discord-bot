import assert from "node:assert/strict";
import test from "node:test";
import type { Config } from "../src/config.js";
import { BudgetExceededError, CostGuard } from "../src/cost-guard.js";
import { StateStore } from "../src/store.js";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function config(overrides: Partial<Config> = {}): Config {
  return {
    discordToken: "test", openaiApiKey: "test", openaiModel: "gpt-5.6", reasoningEffort: "low",
    maxOutputTokens: 2000, historyMessageLimit: 30, historyMaxChars: 12000,
    summaryEveryMentions: 8, summaryMaxTokens: 600, monthlyBudgetUsd: 20,
    maxDailyApiCalls: 80, inputPrice: 5, cachedInputPrice: 0.5, cacheWritePrice: 6.25,
    outputPrice: 30, channelCooldownMs: 5000, allowedChannelIds: new Set(),
    stateFile: "unused", logLevel: "error", ...overrides,
  };
}

async function guard(overrides: Partial<Config> = {}): Promise<CostGuard> {
  const directory = await mkdtemp(join(tmpdir(), "discord-bot-test-"));
  const store = new StateStore(join(directory, "state.json"));
  await store.init();
  return new CostGuard(config(overrides), store);
}

test("calculates cached and uncached token cost", async () => {
  const subject = await guard();
  const cost = subject.cost({ inputTokens: 1_000_000, cachedInputTokens: 200_000, cacheWriteTokens: 100_000, outputTokens: 100_000 });
  assert.equal(cost, 7.225);
});

test("blocks a request whose conservative reservation exceeds the monthly cap", async () => {
  const subject = await guard({ monthlyBudgetUsd: 0.001 });
  await assert.rejects(
    subject.reserve(1000, 2000, new Date("2026-08-03T00:00:00Z")),
    (error: unknown) => error instanceof BudgetExceededError && error.reason === "monthly_budget",
  );
});

test("reserves conservatively from UTF-8 bytes", async () => {
  const subject = await guard({ inputPrice: 5, outputPrice: 30 });
  const reservation = await subject.reserve(Buffer.byteLength("日本語"), 100, new Date("2026-08-03T00:00:00Z"));
  assert.equal(reservation.reservedUsd, ((9 + 1500) * 5 + 100 * 30) / 1_000_000);
});

test("enforces the daily API call limit", async () => {
  const subject = await guard({ maxDailyApiCalls: 1 });
  const now = new Date("2026-08-03T00:00:00Z");
  await subject.reserve(100, 128, now);
  await assert.rejects(
    subject.reserve(100, 128, now),
    (error: unknown) => error instanceof BudgetExceededError && error.reason === "daily_calls",
  );
});

test("normalizes persisted state and drops unknown transcript fields", async () => {
  const directory = await mkdtemp(join(tmpdir(), "discord-bot-state-test-"));
  const path = join(directory, "state.json");
  await writeFile(path, JSON.stringify({
    version: 1,
    channels: { "123": { summary: "durable summary", mentionsSinceSummary: 2, updatedAt: "2026-08-03T00:00:00.000Z", rawHistory: "must disappear" } },
    monthlyUsage: {},
    dailyCalls: {},
    rawTranscript: "must disappear",
  }));
  const store = new StateStore(path);
  await store.init();
  await store.mutate(() => undefined);
  const persisted = await readFile(path, "utf8");
  assert.equal(persisted.includes("rawHistory"), false);
  assert.equal(persisted.includes("rawTranscript"), false);
  assert.equal((await store.channel("123")).summary, "durable summary");
});

import assert from "node:assert/strict";
import test from "node:test";
import { appendApiUsageNote, asksAboutApiCost } from "../src/usage-note.js";

test("recognizes API cost questions without matching unrelated prices", () => {
  assert.equal(asksAboutApiCost("このBotは1メッセージいくら？"), true);
  assert.equal(asksAboutApiCost("この商品の値段はいくら？"), false);
});

test("appends measured usage only to cost questions", () => {
  const usage = { inputTokens: 1234, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 56 };
  assert.match(appendApiUsageNote("回答", "API費用は？", usage, 0.0123456), /入力 1,234 \/ 出力 56 tokens、推定 \$0\.012346/);
  assert.equal(appendApiUsageNote("回答", "こんにちは", usage, 0.0123456), "回答");
});

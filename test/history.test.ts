import assert from "node:assert/strict";
import test from "node:test";
import { stripBotMention } from "../src/history.js";

test("removes normal and nickname-form bot mentions", () => {
  assert.equal(stripBotMention("<@123> hello <@!123>", "123"), "hello");
});

import type { TokenUsage } from "./cost-guard.js";

export function asksAboutApiCost(question: string): boolean {
  const subject = /(?:api|token|トークン|メッセージ|回答|返答|bot|ボット)/i;
  const cost = /(?:price|cost|料金|費用|コスト|課金|値段|いくら|何円|何ドル)/i;
  return subject.test(question) && cost.test(question);
}

export function appendApiUsageNote(
  text: string,
  question: string,
  usage: TokenUsage,
  costUsd: number,
): string {
  if (!asksAboutApiCost(question)) return text;
  return `${text}\n\n_この回答のAPI使用量: 入力 ${usage.inputTokens.toLocaleString("en-US")} / 出力 ${usage.outputTokens.toLocaleString("en-US")} tokens、推定 $${costUsd.toFixed(6)}_`;
}

import { createHash } from "node:crypto";

type Level = "debug" | "info" | "warn" | "error";
type Metadata = Record<string, string | number | boolean | null | undefined>;

const levels: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function hashId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function safetyIdentifier(discordUserId: string): string {
  return createHash("sha256").update(`discord:${discordUserId}`).digest("hex");
}

export class Logger {
  constructor(private readonly minimum: Level) {}

  debug(event: string, metadata: Metadata = {}): void { this.write("debug", event, metadata); }
  info(event: string, metadata: Metadata = {}): void { this.write("info", event, metadata); }
  warn(event: string, metadata: Metadata = {}): void { this.write("warn", event, metadata); }
  error(event: string, metadata: Metadata = {}): void { this.write("error", event, metadata); }

  private write(level: Level, event: string, metadata: Metadata): void {
    if (levels[level] < levels[this.minimum]) return;
    // Deliberately log metadata only. Message bodies, prompts, summaries, and model output are never accepted here.
    process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, event, ...metadata })}\n`);
  }
}

export function safeError(error: unknown): Metadata {
  if (!error || typeof error !== "object") return { errorType: typeof error };
  const candidate = error as Record<string, unknown>;
  const code = typeof candidate.code === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(candidate.code)
    ? candidate.code
    : undefined;
  return {
    errorType: typeof candidate.name === "string" ? candidate.name : "Error",
    status: typeof candidate.status === "number" ? candidate.status : undefined,
    code,
  };
}

// Lightweight logger that persists to AppLog table for dashboard feed.
// Also mirrors to console for dev visibility.

import { db } from "@/lib/db";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSource =
  | "engine"
  | "risk"
  | "scam"
  | "cex"
  | "dex"
  | "portfolio"
  | "api"
  | "selector"
  | "market"
  | "ai"
  | "goplus"
  | "site";

const MAX_LOG_ROWS = 500;

export async function log(
  level: LogLevel,
  source: LogSource,
  message: string,
  context?: Record<string, unknown>
): Promise<void> {
  const prefix = `[${level.toUpperCase()}] [${source}]`;
  const ctxStr = context ? " " + JSON.stringify(context) : "";
  if (level === "error") {
    console.error(prefix, message, ctxStr);
  } else if (level === "warn") {
    console.warn(prefix, message, ctxStr);
  } else {
    console.log(prefix, message, ctxStr);
  }

  try {
    await db.appLog.create({
      data: {
        level,
        source,
        message,
        context: context ? JSON.stringify(context) : null,
      },
    });
    // Trim old logs to keep table small.
    // Cheap heuristic: delete rows with id < (max - MAX_LOG_ROWS).
    const latest = await db.appLog.findFirst({
      orderBy: { id: "desc" },
      select: { id: true },
    });
    if (latest) {
      const cutoff = latest.id - MAX_LOG_ROWS;
      if (cutoff > 0) {
        await db.appLog.deleteMany({ where: { id: { lt: cutoff } } });
      }
    }
  } catch (err) {
    // Don't let logging failures break the engine.
    console.error("[logger] failed to persist log:", err);
  }
}

export const logger = {
  debug: (source: LogSource, msg: string, ctx?: Record<string, unknown>) =>
    log("debug", source, msg, ctx),
  info: (source: LogSource, msg: string, ctx?: Record<string, unknown>) =>
    log("info", source, msg, ctx),
  warn: (source: LogSource, msg: string, ctx?: Record<string, unknown>) =>
    log("warn", source, msg, ctx),
  error: (source: LogSource, msg: string, ctx?: Record<string, unknown>) =>
    log("error", source, msg, ctx),
};

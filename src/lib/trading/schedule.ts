// Trading schedule — restricts when the engine may open new positions.
//
// Behavior:
//   - If `enabled === false`, the engine is unrestricted (always allowed to scout).
//   - If `enabled === true`, the engine checks `isWithinSchedule(now)` before
//     starting a new round. MONITOR/EXIT (TP/SL/timeout/surveillance) of existing
//     open positions continues 24/7 — only SCOUT (new positions) is gated.
//   - If `forceCloseAtEnd === true`, the engine will force-close all open
//     positions at the moment the schedule window closes.
//
// Time logic uses the configured IANA timezone (e.g. "America/Sao_Paulo").
// We use Intl.DateTimeFormat with timeZone option to extract local weekday/hour,
// which is the standard cross-runtime way to handle tz in JS without external libs.

import { db } from "@/lib/db";
import { logger } from "./logger";

export interface TradingSchedule {
  enabled: boolean;
  daysOfWeek: number[]; // 0 (Sun) .. 6 (Sat)
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  timezone: string; // IANA tz
  forceCloseAtEnd: boolean;
  updatedAt: Date;
}

export const DEFAULT_SCHEDULE: TradingSchedule = {
  enabled: false,
  daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
  startTime: "09:00",
  endTime: "21:00",
  timezone: "America/Sao_Paulo",
  forceCloseAtEnd: false,
  updatedAt: new Date(),
};

function parseDaysOfWeek(raw: string): number[] {
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) {
      return v
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    }
  } catch {
    /* ignore */
  }
  return [1, 2, 3, 4, 5];
}

export async function getSchedule(): Promise<TradingSchedule> {
  const row = await db.tradingSchedule.findUnique({ where: { id: "singleton" } });
  if (!row) {
    return { ...DEFAULT_SCHEDULE };
  }
  return {
    enabled: row.enabled,
    daysOfWeek: parseDaysOfWeek(row.daysOfWeek),
    startTime: row.startTime,
    endTime: row.endTime,
    timezone: row.timezone,
    forceCloseAtEnd: row.forceCloseAtEnd,
    updatedAt: row.updatedAt,
  };
}

export async function updateSchedule(
  patch: Partial<Omit<TradingSchedule, "updatedAt">>
): Promise<TradingSchedule> {
  const data: Record<string, unknown> = {};
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.daysOfWeek !== undefined) {
    data.daysOfWeek = JSON.stringify(
      patch.daysOfWeek.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    );
  }
  if (patch.startTime !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(patch.startTime)) {
      throw new Error("startTime deve estar no formato HH:MM");
    }
    data.startTime = patch.startTime;
  }
  if (patch.endTime !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(patch.endTime)) {
      throw new Error("endTime deve estar no formato HH:MM");
    }
    data.endTime = patch.endTime;
  }
  if (patch.timezone !== undefined) {
    // Validate tz by attempting to format with it.
    try {
      Intl.DateTimeFormat("en-US", { timeZone: patch.timezone });
    } catch {
      throw new Error(`Timezone inválido: ${patch.timezone}`);
    }
    data.timezone = patch.timezone;
  }
  if (patch.forceCloseAtEnd !== undefined) data.forceCloseAtEnd = patch.forceCloseAtEnd;

  await db.tradingSchedule.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...data },
    update: data,
  });
  return getSchedule();
}

// Parse "HH:MM" into total minutes since midnight.
function parseHM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

// Returns local weekday (0-6, Sun=0) and minutes-since-midnight for `now`
// in the configured timezone. Uses Intl.DateTimeFormat parts.
function getLocalParts(
  now: Date,
  timezone: string
): { weekday: number; minutes: number } {
  // weekday: Sunday=0 .. Saturday=6 — Intl returns "sun".."sat"
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() ?? "sun";
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
  const minuteStr = parts.find((p) => p.type === "minute")?.value ?? "0";
  const wdMap: Record<string, number> = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  const weekday = wdMap[weekdayStr] ?? 0;
  let hour = parseInt(hourStr, 10);
  if (isNaN(hour)) hour = 0;
  // Intl can return "24" for midnight in some environments — normalize.
  if (hour === 24) hour = 0;
  const minute = parseInt(minuteStr, 10) || 0;
  return { weekday, minutes: hour * 60 + minute };
}

export interface ScheduleStatus {
  enabled: boolean;
  within: boolean;
  weekday: number;
  localTime: string; // "HH:MM"
  startTime: string;
  endTime: string;
  nextChange: "open" | "close" | null;
  // Human-readable reason
  reason: string;
}

export async function getScheduleStatus(now: Date = new Date()): Promise<ScheduleStatus> {
  const sched = await getSchedule();
  if (!sched.enabled) {
    return {
      enabled: false,
      within: true,
      weekday: getLocalParts(now, sched.timezone).weekday,
      localTime: formatLocalTime(now, sched.timezone),
      startTime: sched.startTime,
      endTime: sched.endTime,
      nextChange: null,
      reason: "Agenda desativada — engine pode operar 24/7",
    };
  }
  const { weekday, minutes } = getLocalParts(now, sched.timezone);
  const startMin = parseHM(sched.startTime);
  const endMin = parseHM(sched.endTime);
  const dayOk = sched.daysOfWeek.length === 0 || sched.daysOfWeek.includes(weekday);
  const timeOk = startMin <= endMin
    ? minutes >= startMin && minutes < endMin
    : minutes >= startMin || minutes < endMin; // overnight wrap, e.g. 22:00..04:00
  const within = dayOk && timeOk;
  let reason: string;
  if (within) {
    reason = `Dentro da janela (${sched.startTime}-${sched.endTime}, ${tzLabel(sched.timezone)})`;
  } else if (!dayOk) {
    reason = `Fora da janela — dia da semana não permitido`;
  } else {
    reason = `Fora da janela — antes/after do horário permitido`;
  }
  return {
    enabled: true,
    within,
    weekday,
    localTime: formatLocalTime(now, sched.timezone),
    startTime: sched.startTime,
    endTime: sched.endTime,
    nextChange: within ? "close" : "open",
    reason,
  };
}

function formatLocalTime(now: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(now);
}

function tzLabel(tz: string): string {
  // Produces a short tz label like "America/Sao_Paulo (UTC-3)"
  try {
    const offset = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
    return `${tz} (${offset})`;
  } catch {
    return tz;
  }
}

// Convenience: is the engine allowed to scout right now?
export async function canScoutNow(): Promise<boolean> {
  const status = await getScheduleStatus();
  return status.within;
}

// Force-close all open positions — used when forceCloseAtEnd is true and
// the schedule window just closed. Returns count of closed positions.
export async function forceCloseAllIfOutsideWindow(): Promise<number> {
  const sched = await getSchedule();
  if (!sched.enabled || !sched.forceCloseAtEnd) return 0;
  const status = await getScheduleStatus();
  if (status.within) return 0;
  // We are outside the window + forceClose is set — close all open positions.
  const openPositions = await db.position.findMany({
    where: { status: "open" },
    select: { id: true, symbol: true },
  });
  if (openPositions.length === 0) return 0;
  const now = new Date();
  let closed = 0;
  for (const p of openPositions) {
    try {
      await db.position.update({
        where: { id: p.id },
        data: {
          status: "killed",
          exitAt: now,
          exitReason: "schedule_force_close",
          exitPriceUsd: 0, // portfolio.closePosition would do this properly; this is a safety net
          pnlUsd: 0,
          pnlPct: 0,
        },
      });
      closed++;
    } catch (err) {
      logger.error("schedule", `Erro ao forçar fechamento de ${p.symbol}`, {
        positionId: p.id,
        error: String(err),
      });
    }
  }
  logger.warn(
    "schedule",
    `${closed} posições forçadas a fechar (schedule forceCloseAtEnd)`,
    { reason: "outside_window" }
  );
  return closed;
}

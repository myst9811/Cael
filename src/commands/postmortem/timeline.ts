import type { PostmortemContext } from "./context";

export interface TimelineEvent {
  timestamp: string;    // ISO 8601, or "" for untimed
  source: "git" | "log";
  container?: string;
  message: string;
  level?: "error" | "warn" | "info";
}

const GIT_LINE_RE = /^([0-9a-f]{7,40})\s+(\S+)\s+(.+)$/;
const LOG_TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/;
const STRIP_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?\s*/;
const PID_RE = /\[\d+\]\s*/g;
const ERROR_RE = /\b(error|fatal|critical)\b/i;
const WARN_RE = /\b(warn(?:ing)?)\b/i;

function normalizeLogLine(line: string): string {
  return line.replace(STRIP_TS_RE, "").replace(PID_RE, "").trim().slice(0, 100);
}

function classifyLevel(line: string): TimelineEvent["level"] {
  if (ERROR_RE.test(line)) return "error";
  if (WARN_RE.test(line)) return "warn";
  return "info";
}

export function extractTimeline(ctx: PostmortemContext): TimelineEvent[] {
  const timed: TimelineEvent[] = [];
  const untimed: TimelineEvent[] = [];

  // Git pass
  for (const line of ctx.gitTimelineLog.split("\n").filter(Boolean)) {
    const m = line.match(GIT_LINE_RE);
    if (!m) continue;
    const [, hash, ts, msg] = m;
    timed.push({ timestamp: ts!, source: "git", message: `${msg} (${hash!.slice(0, 7)})` });
  }

  // Log pass with per-container deduplication
  for (const { name, logs } of ctx.containerLogs) {
    const buckets = new Map<string, { count: number; ts: string; level: TimelineEvent["level"]; raw: string }>();
    for (const line of logs.split("\n").filter(Boolean)) {
      const tsMatch = line.match(LOG_TS_RE);
      const ts = tsMatch ? tsMatch[1]! : "";
      const normalized = normalizeLogLine(line);
      const prefix = normalized.slice(0, 60);
      const level = classifyLevel(line);
      const existing = buckets.get(prefix);
      if (existing) {
        existing.count++;
        if (ts) existing.ts = ts;
        if (level === "error") existing.level = "error";
        else if (level === "warn" && existing.level !== "error") existing.level = "warn";
      } else {
        buckets.set(prefix, { count: 1, ts, level, raw: normalized });
      }
    }
    for (const [, { count, ts, level, raw }] of buckets) {
      const msg = count > 1 ? `${raw} ×${count}` : raw;
      const event: TimelineEvent = { timestamp: ts, source: "log", container: name, message: msg, level };
      if (ts) timed.push(event); else untimed.push(event);
    }
  }

  timed.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return [...timed, ...untimed];
}

export function formatTimeline(events: TimelineEvent[]): string {
  if (events.length === 0) return "";
  const timed = events.filter(e => e.timestamp !== "");
  const untimed = events.filter(e => e.timestamp === "");

  const rows: string[] = ["| Time | Source | Message |", "|------|--------|---------|"];

  for (const e of timed) {
    const time = e.timestamp.replace("T", " ").slice(0, 19);
    const src = e.source === "git" ? "git" : `${e.container ?? "log"}${e.level === "error" ? " ⚠" : ""}`;
    rows.push(`| ${time} | ${src} | ${e.message.replace(/\|/g, "\\|")} |`);
  }

  if (untimed.length > 0) {
    rows.push("", "**Untimed Evidence**", "");
    for (const e of untimed) {
      rows.push(`- [${e.container ?? "log"}] ${e.message}`);
    }
  }

  return rows.join("\n");
}

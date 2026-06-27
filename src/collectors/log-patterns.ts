import { getDockerLogs } from "./docker";
import type { DockerLogPatterns, LogPattern } from "./types";

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?\s*/;
const PID_RE = /\[\d+\]\s*/g;
const ERROR_RE = /\b(error|fatal|critical)\b/i;
const WARN_RE = /\b(warn(?:ing)?)\b/i;

function extractTimestamp(line: string): string | undefined {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : undefined;
}

function normalizeLine(line: string): string {
  return line.replace(TIMESTAMP_RE, "").replace(PID_RE, "").trim().slice(0, 120);
}

export function analyzeLogLines(
  lines: string[],
): Omit<DockerLogPatterns, "container" | "total_lines" | "truncated"> {
  const buckets = new Map<string, {
    count: number; first_seen?: string; last_seen?: string;
    level: LogPattern["level"]; raw: string;
  }>();
  let error_count = 0;
  let warn_count = 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    const normalized = normalizeLine(line);
    const prefix = normalized.slice(0, 60);
    const ts = extractTimestamp(line);
    const isError = ERROR_RE.test(line);
    const isWarn = !isError && WARN_RE.test(line);
    if (isError) error_count++;
    if (isWarn) warn_count++;
    const level: LogPattern["level"] = isError ? "error" : isWarn ? "warn" : "unknown";

    const existing = buckets.get(prefix);
    if (existing) {
      existing.count++;
      if (ts) existing.last_seen = ts;
      if (level === "error") existing.level = "error";
      else if (level === "warn" && existing.level !== "error") existing.level = "warn";
    } else {
      buckets.set(prefix, { count: 1, first_seen: ts, last_seen: ts, level, raw: normalized });
    }
  }

  const patterns: LogPattern[] = [...buckets.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([, v]) => ({
      pattern: v.raw,
      count: v.count,
      first_seen: v.first_seen,
      last_seen: v.last_seen,
      level: v.level,
    }));

  return { lines_analyzed: lines.length, error_count, warn_count, patterns };
}

export async function getDockerLogPatterns(
  container: string,
  lines = 200,
  since?: string,
): Promise<DockerLogPatterns> {
  const result = await getDockerLogs(container, lines, since);
  const logLines = result.logs.split("\n").filter(l => l.trim() && l.trim() !== "[truncated]");
  const analysis = analyzeLogLines(logLines);
  return {
    container,
    total_lines: logLines.length,
    truncated: result.truncated,
    ...analysis,
  };
}

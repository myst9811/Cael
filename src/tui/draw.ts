import type { WatchMode } from "./state";
import { renderMarkdown } from "./markdown";

// ── ANSI codes ───────────────────────────────────────────────────────────────
export const A = {
  reset:         "\x1b[0m",
  bold:          "\x1b[1m",
  dim:           "\x1b[2m",
  green:         "\x1b[32m",
  yellow:        "\x1b[33m",
  red:           "\x1b[31m",
  brightGreen:   "\x1b[92m",
  hideCursor:    "\x1b[?25l",
  showCursor:    "\x1b[?25h",
  saveCursor:    "\x1b7",
  restoreCursor: "\x1b8",
  clearBelow:    "\x1b[0J",
  cursorHome:    "\x1b[H",
  altEnter:      "\x1b[?1049h",
  altExit:       "\x1b[?1049l",
} as const;

// ── Box chars ────────────────────────────────────────────────────────────────
const B = {
  tl: "╔", tr: "╗", bl: "╚", br: "╝",
  h: "═", v: "║",
  lj: "╠", rj: "╣",
  tj: "╦", bj: "╩",
} as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function visLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function pad(s: string, width: number): string {
  const vl = visLen(s);
  if (vl >= width) {
    // Trim visible content while preserving trailing reset
    let count = 0;
    let i = 0;
    while (i < s.length && count < width) {
      if (s[i] === "\x1b") {
        while (i < s.length && s[i] !== "m") i++;
        i++;
      } else {
        count++;
        i++;
      }
    }
    return s.slice(0, i) + A.reset;
  }
  return s + " ".repeat(width - vl);
}

function hline(width: number, char = B.h): string {
  return char.repeat(width);
}

// ── Alert generation ─────────────────────────────────────────────────────────

import type { SystemMetrics, DockerStatus, GitStatus, CollectorError } from "../collectors/types";

export function generateAlerts(
  system: SystemMetrics | CollectorError,
  docker: DockerStatus | CollectorError,
): string[] {
  const alerts: string[] = [];
  if (!("error" in system)) {
    const m = system as SystemMetrics;
    if (m.disk_percent > 95) alerts.push(`${"\x1b[31m"}✕ DISK CRITICAL ${m.disk_percent.toFixed(0)}%${A.reset}`);
    else if (m.disk_percent > 85) alerts.push(`${"\x1b[33m"}⚠ Disk ${m.disk_percent.toFixed(0)}% full${A.reset}`);
    if (m.cpu_percent > 90) alerts.push(`${"\x1b[33m"}⚠ CPU ${m.cpu_percent.toFixed(0)}% high${A.reset}`);
    if (m.mem_percent > 90) alerts.push(`${"\x1b[33m"}⚠ Memory ${Math.min(m.mem_percent, 100).toFixed(0)}% used${A.reset}`);
  }
  if (!("error" in docker)) {
    const d = docker as DockerStatus;
    if (d.available) {
      for (const c of d.containers) {
        if (c.status === "restarting") {
          alerts.push(`${"\x1b[33m"}↻ ${c.name} is restarting${A.reset}`);
        } else if (c.status === "exited" && c.exit_code !== 0) {
          alerts.push(`${"\x1b[31m"}✕ ${c.name} exited (code ${c.exit_code ?? "?"})${A.reset}`);
        }
      }
    }
  }
  return alerts;
}

// ── Frame builder ─────────────────────────────────────────────────────────────

export interface FrameOptions {
  cols: number;
  rows: number;
  systemLines: string[];
  dockerLines: string[];
  gitLines: string[];
  alerts: string[];
  mode: WatchMode;
  queryInput: string;
  aiResponse: string;
  agentActivity: string;
  scrollOffset?: number; // 0 = pinned to bottom; omit or 0 for auto-scroll
  timestamp: string;
  statusError?: string | null;
}

function wrapWords(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && visLen(cur) + 1 + visLen(w) > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export function buildFrame(opts: FrameOptions): string {
  const { cols } = opts;
  const innerW = Math.max(cols - 2, 40);

  // Panel widths: split inner width across 3 panels and 2 dividers
  const available = innerW - 2; // subtract 2 inner dividers
  const w1 = Math.floor(available / 3);
  const w2 = Math.floor(available / 3);
  const w3 = available - w1 - w2;

  const PANEL_ROWS = 5; // fixed panel content rows

  let frame = "";

  // ── Top border + header ───────────────────────────────────────────────────
  const title = `${A.bold}${A.brightGreen} cael watch ${A.reset}`;
  const ts = `${A.dim}${opts.timestamp}${A.reset}`;
  const hint = `${A.dim}[/] ask  [q] quit${A.reset}`;
  const headerContent = `${title}  ${ts}  ${hint}`;
  frame += `${B.tl}${hline(innerW)}${B.tr}\n`;
  frame += `${B.v}${pad(headerContent, innerW)}${B.v}\n`;

  // ── Panel section ─────────────────────────────────────────────────────────
  frame += `${B.lj}${hline(w1)}${B.tj}${hline(w2)}${B.tj}${hline(w3)}${B.rj}\n`;

  const sys = opts.systemLines;
  const doc = opts.dockerLines;
  const git = opts.gitLines;

  for (let i = 0; i < PANEL_ROWS; i++) {
    const l = (i < sys.length ? sys[i] : undefined) ?? "";
    const m = (i < doc.length ? doc[i] : undefined) ?? "";
    const r = (i < git.length ? git[i] : undefined) ?? "";
    frame += `${B.v}${pad(l, w1)}${B.v}${pad(m, w2)}${B.v}${pad(r, w3)}${B.v}\n`;
  }

  // ── Alert bar ─────────────────────────────────────────────────────────────
  frame += `${B.lj}${hline(w1)}${B.bj}${hline(w2)}${B.bj}${hline(w3)}${B.rj}\n`;

  if (opts.alerts.length === 0) {
    frame += `${B.v}${pad(`  ${A.dim}system nominal${A.reset}`, innerW)}${B.v}\n`;
  } else {
    for (const alert of opts.alerts.slice(0, 2)) {
      frame += `${B.v}${pad(`  ${alert}`, innerW)}${B.v}\n`;
    }
  }

  // ── Status / query / AI response ─────────────────────────────────────────
  // Compute how many rows the status section can fill.
  //   Fixed rows (excl. status section + bottom border):
  //     top border(1) + header(1) + panel-sep(1) + panels(5) + alert-sep(1) + alert-rows(A) + status-sep(1) = 11 + A
  //   Bottom border: 1
  //   So status rows = opts.rows - 12 - alertRows
  const alertRows = opts.alerts.length === 0 ? 1 : Math.min(opts.alerts.length, 2);
  // statusSectionRows: total rows in the status section (content rows + 1 bottom-anchor row).
  // All three modes produce exactly this many rows so the frame height is always opts.rows.
  const statusSectionRows = Math.max(3, opts.rows - 12 - alertRows);
  const contentRows = statusSectionRows - 1; // last row is always the anchor (dismiss/prompt/hint)

  frame += `${B.lj}${hline(innerW)}${B.rj}\n`;

  if (opts.mode === "IDLE") {
    // Blank rows above, status hint pinned to the bottom row.
    for (let i = 0; i < contentRows; i++) {
      frame += `${B.v}${pad("", innerW)}${B.v}\n`;
    }
    const idleStatus = opts.statusError
      ? `  ${A.yellow}⚠ collect error: ${opts.statusError}${A.reset}`
      : `  ${A.dim}press / to ask Cael a question${A.reset}`;
    frame += `${B.v}${pad(idleStatus, innerW)}${B.v}\n`;
  } else if (opts.mode === "QUERYING") {
    // Blank rows above, input prompt pinned to the bottom row.
    for (let i = 0; i < contentRows; i++) {
      frame += `${B.v}${pad("", innerW)}${B.v}\n`;
    }
    const cursor = "\x1b[7m \x1b[0m";
    frame += `${B.v}${pad(`  ${A.brightGreen}>${A.reset} ${opts.queryInput}${cursor}`, innerW)}${B.v}\n`;
  } else {
    // SHOWING_RESULT — show the submitted question, then the streamed response.
    // Auto-scroll so the latest text is always visible.
    const responseContentRows = contentRows;

    const responseLines = renderMarkdown(opts.aiResponse, innerW - 4);
    // Reserve one row for agentActivity when there's room (responseContentRows >= 2).
    const hasActivityRow = responseContentRows >= 2;
    const visibleResponseRows = hasActivityRow ? responseContentRows - 1 : responseContentRows;
    const maxOffset = Math.max(0, responseLines.length - visibleResponseRows);
    const offset = Math.min(opts.scrollOffset ?? 0, maxOffset);
    let visible: string[];
    if (responseLines.length <= visibleResponseRows) {
      visible = [...responseLines, ...Array<string>(visibleResponseRows - responseLines.length).fill("")];
    } else {
      const end = responseLines.length - offset;
      visible = responseLines.slice(end - visibleResponseRows, end);
    }
    for (const rl of visible) {
      frame += `${B.v}${pad(`  ${rl}`, innerW)}${B.v}\n`;
    }
    if (hasActivityRow) {
      const activityText = opts.agentActivity
        ? `  ${A.dim}${opts.agentActivity}${A.reset}`
        : "";
      frame += `${B.v}${pad(activityText, innerW)}${B.v}\n`;
    }
    const scrollHint = maxOffset > 0
      ? `  ${A.dim}[↑↓] scroll · [/] ask more · [ESC] clear${A.reset}`
      : `  ${A.dim}[/] ask more · [ESC] clear${A.reset}`;
    frame += `${B.v}${pad(scrollHint, innerW)}${B.v}\n`;
  }

  // ── Bottom border ─────────────────────────────────────────────────────────
  frame += `${B.bl}${hline(innerW)}${B.br}\n`;

  return frame;
}

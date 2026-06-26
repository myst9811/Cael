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
  const critical: string[] = [];
  const warnings: string[] = [];
  if (!("error" in system)) {
    const m = system as SystemMetrics;
    if (m.disk_percent > 95) critical.push(`${"\x1b[31m"}✕ DISK CRITICAL ${m.disk_percent.toFixed(0)}%${A.reset}`);
    else if (m.disk_percent > 85) warnings.push(`${"\x1b[33m"}⚠ Disk ${m.disk_percent.toFixed(0)}% full${A.reset}`);
    if (m.cpu_percent > 90) warnings.push(`${"\x1b[33m"}⚠ CPU ${m.cpu_percent.toFixed(0)}% high${A.reset}`);
    if (m.mem_percent > 90) warnings.push(`${"\x1b[33m"}⚠ Memory ${Math.min(m.mem_percent, 100).toFixed(0)}% used${A.reset}`);
    if (m.disk_inode_percent !== undefined) {
      if (m.disk_inode_percent > 95) critical.push(`${"\x1b[31m"}✕ INODES CRITICAL ${m.disk_inode_percent.toFixed(0)}%${A.reset}`);
      else if (m.disk_inode_percent > 85) warnings.push(`${"\x1b[33m"}⚠ Inodes ${m.disk_inode_percent.toFixed(0)}% used${A.reset}`);
    }
  }
  if (!("error" in docker)) {
    const d = docker as DockerStatus;
    if (d.available) {
      for (const c of d.containers) {
        if (c.status === "restarting") {
          warnings.push(`${"\x1b[33m"}↻ ${c.name} is restarting${A.reset}`);
        } else if (c.status === "exited" && c.exit_code !== 0) {
          critical.push(`${"\x1b[31m"}✕ ${c.name} exited (code ${c.exit_code ?? "?"})${A.reset}`);
        }
      }
    }
  }
  return [...critical, ...warnings];
}

function freshnessDot(lastRefreshAt: number, isError: boolean): string {
  if (isError || lastRefreshAt === 0) return `${A.red}○${A.reset}`;
  const ageMs = Date.now() - lastRefreshAt;
  if (ageMs > 30_000) return `${A.red}○${A.reset}`;
  if (ageMs > 10_000) return `${A.yellow}◐${A.reset}`;
  return `${A.green}●${A.reset}`;
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
  // M2 additions (all optional for backward compat)
  detailLines?: string[] | null;
  compact?: boolean;
  lastRefreshAt?: number;
  panelErrors?: { system: boolean; docker: boolean; git: boolean };
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

  const PANEL_ROWS = opts.compact ? 3 : 5;

  let frame = "";

  // ── Top border + header ───────────────────────────────────────────────────
  const title = `${A.bold}${A.brightGreen} cael watch ${A.reset}`;
  const lra = opts.lastRefreshAt ?? 0;
  const ageMs = lra > 0 ? Date.now() - lra : 0;
  const ageAnnotation = ageMs > 30_000
    ? ` ${A.red}(${Math.floor(ageMs / 1000)}s old)${A.reset}`
    : ageMs > 10_000
    ? ` ${A.yellow}(${Math.floor(ageMs / 1000)}s old)${A.reset}`
    : "";
  const ts = `${A.dim}${opts.timestamp}${A.reset}${ageAnnotation}`;
  const hint = `${A.dim}[/] ask  [↑↓] select  [z] compact  [q] quit${A.reset}`;
  const headerContent = `${title}  ${ts}  ${hint}`;
  frame += `${B.tl}${hline(innerW)}${B.tr}\n`;
  frame += `${B.v}${pad(headerContent, innerW)}${B.v}\n`;

  // ── Panel section ─────────────────────────────────────────────────────────
  frame += `${B.lj}${hline(w1)}${B.tj}${hline(w2)}${B.tj}${hline(w3)}${B.rj}\n`;

  const sys = opts.systemLines;
  const doc = opts.dockerLines;
  const git = opts.gitLines;
  const pe = opts.panelErrors;
  const sysDot = pe ? freshnessDot(lra, pe.system) : freshnessDot(lra, false);
  const dkDot  = pe ? freshnessDot(lra, pe.docker) : freshnessDot(lra, false);
  const gtDot  = pe ? freshnessDot(lra, pe.git)    : freshnessDot(lra, false);

  for (let i = 0; i < PANEL_ROWS; i++) {
    const lRaw = (i < sys.length ? sys[i] : undefined) ?? "";
    const mRaw = (i < doc.length ? doc[i] : undefined) ?? "";
    const rRaw = (i < git.length ? git[i] : undefined) ?? "";
    const l = i === 0 ? `${lRaw} ${sysDot}` : lRaw;
    const m = i === 0 ? `${mRaw} ${dkDot}`  : mRaw;
    const r = i === 0 ? `${rRaw} ${gtDot}`  : rRaw;
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

  // ── Detail row (container vital signs) ───────────────────────────────────
  const detailLines = opts.detailLines ?? null;
  if (detailLines !== null && detailLines.length > 0) {
    frame += `${B.lj}${hline(innerW)}${B.rj}\n`;
    for (const dl of detailLines) {
      frame += `${B.v}${pad(dl, innerW)}${B.v}\n`;
    }
  }

  // ── Status / query / AI response ─────────────────────────────────────────
  // Row budget: fixed overhead is 11 rows + alertRows + detailRowCount + (PANEL_ROWS - 5)
  //   When compact (PANEL_ROWS=3): saves 2 panel rows → those flow into status section.
  //   When detail visible: detail rows + 1 separator consumed from status budget.
  const alertRows = opts.alerts.length === 0 ? 1 : Math.min(opts.alerts.length, 2);
  const detailRowCount = detailLines && detailLines.length > 0 ? detailLines.length + 1 : 0;
  const statusSectionRows = Math.max(3, opts.rows - 12 - alertRows - detailRowCount - (PANEL_ROWS - 5));
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

import { collectAll } from "../collectors";
import { renderSystemPanel, renderDockerPanel, renderGitPanel } from "../tui/panels";
import { buildFrame, generateAlerts, A } from "../tui/draw";
import { createWatchState, handleKey } from "../tui/state";
import type { WatchState } from "../tui/state";
import { setupRawMode } from "../tui/input";
import type { LLMProvider, Message } from "../providers/types";
import type { CollectedContext, SystemMetrics, DockerStatus, GitStatus, CollectorError } from "../collectors/types";
import { LOGO, LOGO_ROWS } from "../assets/logo";
import { runWatchAgentLoop } from "./watch-agent";
import { watchTools, watchExecuteToolWithTimeout } from "../tools";

const REFRESH_MS = 5000;

function isError(v: unknown): v is CollectorError {
  return typeof v === "object" && v !== null && "error" in v;
}

function formatSystemPrompt(ctx: CollectedContext): string {
  const sys = isError(ctx.system)
    ? "unavailable"
    : `CPU ${(ctx.system as SystemMetrics).cpu_percent.toFixed(1)}%, MEM ${(ctx.system as SystemMetrics).mem_used_gb.toFixed(1)}/${(ctx.system as SystemMetrics).mem_total_gb.toFixed(0)}GB, DISK ${(ctx.system as SystemMetrics).disk_percent.toFixed(1)}%`;

  const docker = isError(ctx.docker)
    ? "unavailable"
    : (ctx.docker as DockerStatus).available
      ? (ctx.docker as DockerStatus).containers.map((c) => `${c.name}(${c.status})`).join(", ") || "no containers"
      : "daemon unavailable";

  const git = isError(ctx.git)
    ? "unavailable"
    : (ctx.git as GitStatus).is_git_repo
      ? `branch ${(ctx.git as GitStatus).branch}, ${(ctx.git as GitStatus).dirty_files ?? 0} dirty, ${(ctx.git as GitStatus).unpushed_commits ?? "?"} unpushed`
      : "not a git repo";

  return `You are Cael, a DevOps agent. Answer in 2-3 concise sentences based on the live snapshot.
Never fabricate — use the provided data.

Snapshot (${ctx.timestamp}):
System: ${sys}
Docker: ${docker}
Git: ${git}`;
}

export async function runWatch(provider: LLMProvider): Promise<void> {
  let state: WatchState = createWatchState();
  let lastCtx: CollectedContext | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let querying = false;
  let lastRefreshError: string | null = null;
  let conversationHistory: Message[] = [];

  // ── Cleanup ──────────────────────────────────────────────────────────────
  const onResize = () => { if (!querying) draw(); };

  // Forward-declared so cleanup can deregister it before exiting
  let onCrash: () => void = () => {};

  const cleanup = (code = 0) => {
    if (refreshTimer) clearInterval(refreshTimer);
    process.stdout.removeListener("resize", onResize);
    process.removeListener("uncaughtException", onCrash);
    process.removeListener("unhandledRejection", onCrash);
    process.stdout.write(A.showCursor + A.altExit);
    process.exit(code);
  };

  onCrash = () => cleanup(1);
  process.once("SIGINT", () => cleanup(0));
  process.once("SIGTERM", () => cleanup(0));
  process.once("uncaughtException", onCrash);
  process.once("unhandledRejection", onCrash);

  // ── Draw ─────────────────────────────────────────────────────────────────
  // Restores cursor to the saved position (right below the logo) and redraws
  // the dashboard frame in-place, filling all rows beneath the logo.
  const draw = () => {
    const cols = process.stdout.columns || 80;
    const rows = Math.max(3, (process.stdout.rows || 24) - LOGO_ROWS);
    const frame = buildFrame({
      cols,
      rows,
      systemLines: lastCtx ? renderSystemPanel(lastCtx.system) : ["SYSTEM", "  collecting..."],
      dockerLines: lastCtx ? renderDockerPanel(lastCtx.docker) : ["DOCKER", "  collecting..."],
      gitLines:    lastCtx ? renderGitPanel(lastCtx.git)       : ["GIT",    "  collecting..."],
      alerts: lastCtx ? generateAlerts(lastCtx.system, lastCtx.docker) : [],
      mode: state.mode,
      queryInput: state.queryInput,
      aiResponse: state.aiResponse,
      agentActivity: state.agentActivity,
      scrollOffset: state.scrollOffset,
      timestamp: new Date().toLocaleTimeString(),
      statusError: lastRefreshError,
    });
    const logoBody = LOGO.startsWith("\n") ? LOGO.slice(1) : LOGO;
    process.stdout.write(A.cursorHome + logoBody + "\n" + frame + A.clearBelow);
  };

  // ── Refresh ───────────────────────────────────────────────────────────────
  const doRefresh = async () => {
    if (querying) return;
    try {
      lastCtx = await collectAll();
      lastRefreshError = null;
    } catch (e: unknown) {
      lastRefreshError = e instanceof Error ? e.message : "collection failed";
    }
    if (!querying) draw();
  };

  // Print the logo, save cursor position immediately below it, then collect
  // the first data snapshot. The dashboard renders below the logo on every
  // subsequent draw() by restoring to the saved cursor position.
  process.stdout.write("\x1b[2J\x1b[H" + A.altEnter + "\x1b[2J\x1b[H" + A.hideCursor);
  await doRefresh();

  refreshTimer = setInterval(doRefresh, REFRESH_MS);
  process.stdout.on("resize", onResize);

  // ── AI query ──────────────────────────────────────────────────────────────
  const submitQuery = async (question: string) => {
    querying = true;
    if (refreshTimer) clearInterval(refreshTimer);

    // Collect a fresh snapshot for the system prompt
    let ctx = lastCtx;
    try { ctx = await collectAll(); lastCtx = ctx; } catch (e: unknown) {
      lastRefreshError = e instanceof Error ? e.message : "collection failed";
    }

    const systemPrompt = ctx ? formatSystemPrompt(ctx) : "You are Cael, a DevOps agent.";

    // Build input history without mutating conversationHistory yet
    const inputHistory: Message[] = [
      ...conversationHistory,
      { role: "user" as const, content: question },
    ];

    const prevContent = state.aiResponse.trim();
    const separator = prevContent ? "\n\n" + "─".repeat(40) + "\n\n" : "";
    const turnPrefix = separator + `> ${question}\n\n`;
    state = { ...state, mode: "SHOWING_RESULT", aiResponse: prevContent + turnPrefix, agentActivity: "", scrollOffset: 0 };
    draw();

    try {
      const updatedHistory = await runWatchAgentLoop(
        provider,
        inputHistory,
        watchTools,
        systemPrompt,
        {
          onChunk: (chunk) => {
            if (!chunk) return;
            state = { ...state, aiResponse: state.aiResponse + chunk };
            draw();
          },
          onToolCall: (name) => {
            state = { ...state, agentActivity: `⟳ calling ${name}...` };
            draw();
          },
        },
        10,
        watchExecuteToolWithTimeout
      );
      conversationHistory = updatedHistory;
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      let friendly = raw;
      // Anthropic SDK may surface the raw response body as err.message.
      // Try to extract a human-readable string from the JSON payload.
      try {
        const jsonStart = raw.indexOf("{");
        if (jsonStart >= 0) {
          const parsed = JSON.parse(raw.slice(jsonStart)) as { error?: { type?: string; message?: string } };
          if (parsed.error?.type === "overloaded_error") {
            friendly = "API overloaded — try again in a moment";
          } else if (typeof parsed.error?.message === "string") {
            friendly = parsed.error.message;
          }
        }
      } catch { /* not JSON — use raw */ }
      state = { ...state, aiResponse: state.aiResponse + `Error: ${friendly}` };
      draw();
    } finally {
      state = { ...state, agentActivity: "" };
      querying = false;
      refreshTimer = setInterval(doRefresh, REFRESH_MS);
      draw();
    }
  };

  // ── Keyboard input ────────────────────────────────────────────────────────
  const restoreRaw = setupRawMode((key) => {
    // Handle query submission before state machine
    if (state.mode === "QUERYING" && (key === "\r" || key === "\n")) {
      if (querying) return;
      const q = state.queryInput.trim();
      if (q) {
        state = { ...state, queryInput: q };
        submitQuery(q).catch(() => {});
      }
      return;
    }

    // Block dismiss while an agent loop is in progress, but allow quit/Ctrl+C through
    if (state.mode === "SHOWING_RESULT" && querying) {
      if (key === "q" || key === "\x03") { restoreRaw(); cleanup(0); }
      return;
    }

    const { state: next, action } = handleKey(state, key);
    state = next;

    if (action === "quit") {
      restoreRaw();
      cleanup(0);
      return;
    }

    draw();
  });
}

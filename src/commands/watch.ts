import { collectAll } from "../collectors";
import { renderSystemPanel, renderDockerPanel, renderGitPanel } from "../tui/panels";
import { buildFrame, generateAlerts, A } from "../tui/draw";
import { createWatchState, handleKey } from "../tui/state";
import type { WatchState } from "../tui/state";
import { setupRawMode } from "../tui/input";
import type { LLMProvider } from "../providers/types";
import type { CollectedContext, SystemMetrics, DockerStatus, GitStatus, CollectorError } from "../collectors/types";

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

  // ── Cleanup ──────────────────────────────────────────────────────────────
  const onResize = () => { if (!querying) draw(); };

  const cleanup = (code = 0) => {
    if (refreshTimer) clearInterval(refreshTimer);
    process.stdout.removeListener("resize", onResize);
    process.stdout.write(A.showCursor);
    process.exit(code);
  };

  process.on("SIGINT", () => cleanup(0));
  process.on("SIGTERM", () => cleanup(0));

  // Hide cursor and save position right after the logo (printed by index.ts).
  // Each redraw restores to this position and overwrites the previous frame.
  process.stdout.write(A.hideCursor + A.saveCursor);

  // ── Draw ─────────────────────────────────────────────────────────────────
  const draw = () => {
    const cols = process.stdout.columns || 80;
    const frame = buildFrame({
      cols,
      systemLines: lastCtx ? renderSystemPanel(lastCtx.system) : ["SYSTEM", "  collecting..."],
      dockerLines: lastCtx ? renderDockerPanel(lastCtx.docker) : ["DOCKER", "  collecting..."],
      gitLines:    lastCtx ? renderGitPanel(lastCtx.git)       : ["GIT",    "  collecting..."],
      alerts: lastCtx ? generateAlerts(lastCtx.system, lastCtx.docker) : [],
      mode: state.mode,
      queryInput: state.queryInput,
      aiResponse: state.aiResponse,
      timestamp: new Date().toLocaleTimeString(),
      statusError: lastRefreshError,
    });
    process.stdout.write(A.restoreCursor + frame);
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
    if (!querying && state.mode === "IDLE") draw();
  };

  await doRefresh();
  refreshTimer = setInterval(doRefresh, REFRESH_MS);
  process.stdout.on("resize", onResize);

  // ── AI query ──────────────────────────────────────────────────────────────
  const submitQuery = async (question: string) => {
    querying = true;
    if (refreshTimer) clearInterval(refreshTimer);

    // Collect fresh context
    let ctx = lastCtx;
    try { ctx = await collectAll(); lastCtx = ctx; } catch (e: unknown) {
      lastRefreshError = e instanceof Error ? e.message : "collection failed";
    }

    const systemPrompt = ctx ? formatSystemPrompt(ctx) : "You are Cael, a DevOps agent.";
    const messages = [{ role: "user" as const, content: question }];

    state = { ...state, mode: "SHOWING_RESULT", aiResponse: "⟳ thinking..." };
    draw();

    try {
      if (provider.stream) {
        state = { ...state, aiResponse: "" };
        draw();
        await provider.stream(messages, [], (chunk) => {
          state = { ...state, aiResponse: state.aiResponse + chunk };
          draw();
        }, { system: systemPrompt });
      } else {
        const { text } = await provider.chat(messages, [], { system: systemPrompt });
        state = { ...state, aiResponse: text || "(no response)" };
        draw();
      }
    } catch (err: unknown) {
      state = { ...state, aiResponse: `Error: ${err instanceof Error ? err.message : String(err)}` };
      draw();
    } finally {
      querying = false;
      refreshTimer = setInterval(doRefresh, REFRESH_MS);
    }
  };

  // ── Keyboard input ────────────────────────────────────────────────────────
  const restoreRaw = setupRawMode((key) => {
    // Handle query submission before state machine
    if (state.mode === "QUERYING" && (key === "\r" || key === "\n")) {
      const q = state.queryInput.trim();
      if (q) {
        state = { ...state, queryInput: q };
        submitQuery(q).catch(() => {});
      }
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

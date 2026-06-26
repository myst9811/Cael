import { collectAll } from "../collectors";
import { renderSystemPanel, renderDockerPanel, renderGitPanel } from "../tui/panels";
import { buildFrame, generateAlerts, A } from "../tui/draw";
import { createWatchState, handleKey } from "../tui/state";
import type { WatchState } from "../tui/state";
import { setupRawMode } from "../tui/input";
import type { LLMProvider, Message } from "../providers/types";
import type { CollectedContext, SystemMetrics, DockerStatus, GitStatus, CollectorError, ContainerInspect } from "../collectors/types";
import { LOGO, LOGO_ROWS } from "../assets/logo";
import { runWatchAgentLoop } from "./watch-agent";
import { watchTools, watchExecuteToolWithTimeout } from "../tools";
import { getDockerInspect } from "../collectors/docker-inspect";
import { renderContainerDetail } from "../tui/detail";

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
Never fabricate — use the provided data. For deeper investigation use: get_docker_log_patterns, get_listening_ports, get_process_tree, get_runtime_services.

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
  let lastRefreshAt = 0;
  let inspectCache = new Map<string, ContainerInspect>();
  let lastContainerNames: string[] = [];

  // ── Cleanup ──────────────────────────────────────────────────────────────
  const onResize = () => { if (!querying) draw(); };

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
  const draw = () => {
    const cols = process.stdout.columns || 80;
    const rows = Math.max(3, (process.stdout.rows || 24) - LOGO_ROWS);

    const dockerData = lastCtx?.docker;
    const containers = dockerData && "available" in dockerData && (dockerData as DockerStatus).available
      ? (dockerData as DockerStatus).containers
      : [];
    const panelErrors = lastCtx ? {
      system: isError(lastCtx.system),
      docker: isError(lastCtx.docker),
      git:    isError(lastCtx.git),
    } : { system: false, docker: false, git: false };

    const detailLines = state.selectedContainer && inspectCache.has(state.selectedContainer)
      ? renderContainerDetail(inspectCache.get(state.selectedContainer)!, state.compactMode)
      : state.selectedContainer
      ? ["  loading..."]
      : null;

    const frame = buildFrame({
      cols,
      rows,
      systemLines: lastCtx ? renderSystemPanel(lastCtx.system) : ["SYSTEM", "  collecting..."],
      dockerLines: lastCtx
        ? renderDockerPanel(lastCtx.docker, state.panelFocus === "docker" ? state.dockerCursor : -1)
        : ["DOCKER", "  collecting..."],
      gitLines:    lastCtx ? renderGitPanel(lastCtx.git)       : ["GIT",    "  collecting..."],
      alerts: lastCtx ? generateAlerts(lastCtx.system, lastCtx.docker) : [],
      mode: state.mode,
      queryInput: state.queryInput,
      aiResponse: state.aiResponse,
      agentActivity: state.agentActivity,
      scrollOffset: state.scrollOffset,
      timestamp: new Date().toLocaleTimeString(),
      statusError: lastRefreshError,
      detailLines,
      compact: state.compactMode,
      lastRefreshAt,
      panelErrors,
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
      lastRefreshAt = Date.now();

      // Invalidate inspect cache if container set changed
      const newNames = !isError(lastCtx.docker) && (lastCtx.docker as DockerStatus).available
        ? (lastCtx.docker as DockerStatus).containers.map(c => c.name)
        : [];
      const namesChanged =
        JSON.stringify([...newNames].sort()) !== JSON.stringify([...lastContainerNames].sort());
      if (namesChanged) {
        inspectCache = new Map();
        lastContainerNames = newNames;
      }

      // Clamp dockerCursor if container list shrank
      if (state.dockerCursor >= lastContainerNames.length && lastContainerNames.length > 0) {
        state = { ...state, dockerCursor: lastContainerNames.length - 1 };
      }
    } catch (e: unknown) {
      lastRefreshError = e instanceof Error ? e.message : "collection failed";
    }
    if (!querying) draw();
  };

  process.stdout.write("\x1b[2J\x1b[H" + A.altEnter + "\x1b[2J\x1b[H" + A.hideCursor);
  await doRefresh();

  refreshTimer = setInterval(doRefresh, REFRESH_MS);
  process.stdout.on("resize", onResize);

  // ── AI query ──────────────────────────────────────────────────────────────
  const submitQuery = async (question: string) => {
    querying = true;
    if (refreshTimer) clearInterval(refreshTimer);

    let ctx = lastCtx;
    try { ctx = await collectAll(); lastCtx = ctx; } catch (e: unknown) {
      lastRefreshError = e instanceof Error ? e.message : "collection failed";
    }

    const systemPrompt = ctx ? formatSystemPrompt(ctx) : "You are Cael, a DevOps agent.";

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
    if (state.mode === "QUERYING" && (key === "\r" || key === "\n")) {
      if (querying) return;
      const q = state.queryInput.trim();
      if (q) {
        state = { ...state, queryInput: q };
        submitQuery(q).catch(() => {});
      }
      return;
    }

    if (state.mode === "SHOWING_RESULT" && querying) {
      if (key === "q" || key === "\x03") { restoreRaw(); cleanup(0); }
      return;
    }

    const prevSelected = state.selectedContainer;
    const { state: next, action } = handleKey(state, key, lastContainerNames);
    state = next;

    // Trigger inspect fetch when a new container is selected
    if (state.selectedContainer && state.selectedContainer !== prevSelected) {
      const name = state.selectedContainer;
      if (!inspectCache.has(name)) {
        getDockerInspect(name)
          .then(inspect => { inspectCache.set(name, inspect); if (!querying) draw(); })
          .catch(() => {});
      }
    }

    if (action === "quit") {
      restoreRaw();
      cleanup(0);
      return;
    }

    draw();
  });
}

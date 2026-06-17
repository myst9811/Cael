import { readdirSync, realpathSync } from "fs";
import { realpath } from "fs/promises";
import { resolve, dirname, basename } from "path";
import type { ToolDefinition } from "./providers/types";
import { getSystemMetrics } from "./collectors/system";
import { getDockerStatus, getDockerLogs } from "./collectors/docker";
import { getGitStatus } from "./collectors/git";
import { getProcessList } from "./collectors/process";

// ── Path safety ───────────────────────────────────────────────────────────────
// Restrict all file/dir operations to the process working directory to prevent
// the LLM (or a prompt-injected payload) from reading ~/.ssh/id_rsa, etc.
//
// CWD is realpath'd at startup so that a symlinked working directory doesn't
// cause false mismatches when comparing against realpath'd input paths.
const CWD = (() => { try { return realpathSync(process.cwd()); } catch { return process.cwd(); } })();

// Uses realpath() (not resolve()) so symlinks inside CWD that point outside
// the boundary are followed to their true target before the check is applied.
// For paths that don't exist yet (e.g. write_file targets), we realpath the
// parent directory — a non-existent file cannot itself be a symlink.
async function assertWithinCwd(inputPath: string): Promise<string> {
  const lexical = resolve(inputPath);
  let real: string;
  try {
    real = await realpath(lexical);
  } catch {
    // File doesn't exist yet — realpath parent and reconstruct.
    try {
      const parentReal = await realpath(dirname(lexical));
      real = parentReal + "/" + basename(lexical);
    } catch {
      throw new Error(`Access denied: parent directory does not exist`);
    }
  }
  if (real !== CWD && !real.startsWith(CWD + "/")) {
    throw new Error(`Access denied: path must be within the working directory`);
  }
  return real;
}

// ── Shell-injection prevention ────────────────────────────────────────────────
// Parse a command string into argv tokens WITHOUT invoking a shell, so
// metacharacters like ; | & ` $() cannot spawn additional processes.
// Handles single- and double-quoted substrings but intentionally ignores
// shell expansions — they are passed literally to the subprocess.
function parseCommandArgs(cmd: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === " " && !inSingle && !inDouble) {
      if (current) { args.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

const codeTools: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a file's contents from disk",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Path to the file" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file on disk",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to write to" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "run_shell",
    description: "Execute a shell command and return stdout. Commands run directly (no shell), so pipes and redirects are not supported — use individual commands.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string", description: "Command to run (e.g. 'git status' or 'ls -la')" } },
      required: ["command"],
    },
  },
  {
    name: "list_dir",
    description: "List files and folders in a directory",
    input_schema: {
      type: "object",
      properties: { path: { type: "string", description: "Directory path (defaults to .)" } },
      required: [],
    },
  },
];

export const collectorTools: ToolDefinition[] = [
  {
    name: "get_system_metrics",
    description: "Get current CPU, memory, disk usage and load average",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_docker_status",
    description: "List all Docker containers with their current status",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_docker_logs",
    description: "Get recent logs from a Docker container",
    input_schema: {
      type: "object",
      properties: {
        container: { type: "string", description: "Container name or ID" },
        lines: { type: "number", description: "Number of log lines (default 100)" },
        since: { type: "string", description: "Show logs since duration (e.g. 30m, 2h) or ISO timestamp" },
      },
      required: ["container"],
    },
  },
  {
    name: "get_git_status",
    description: "Get current git repository status: branch, dirty files, unpushed commits",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_process_list",
    description: "List running processes sorted by CPU or memory usage",
    input_schema: {
      type: "object",
      properties: {
        sort_by: { type: "string", enum: ["cpu", "mem"], description: "Sort by cpu or mem (default: cpu)" },
        limit: { type: "number", description: "Max processes to return (default: 15)" },
      },
      required: [],
    },
  },
];

export const tools: ToolDefinition[] = [...codeTools, ...collectorTools];

const TOOL_TIMEOUT_MS = 10_000;
const MAX_READ_BYTES = 1_000_000; // 1 MB

export async function executeToolWithTimeout(
  name: string,
  input: Record<string, unknown>,
  timeoutMs = TOOL_TIMEOUT_MS
): Promise<string> {
  // Use finally to always clear the timer, avoiding the leaked-timeout bug.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Tool "${name}" timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([executeTool(name, input), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

export async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "read_file": {
      if (!input.path) return "Error: path is required";
      const safePath = await assertWithinCwd(String(input.path));
      const file = Bun.file(safePath);
      if (file.size > MAX_READ_BYTES) {
        return `Error: file too large (${(file.size / 1024).toFixed(0)} KB); max is 1 MB`;
      }
      return await file.text();
    }

    case "write_file": {
      if (!input.path || !input.content) return "Error: path and content are required";
      const safePath = await assertWithinCwd(String(input.path));
      await Bun.write(safePath, String(input.content));
      return `Written to ${input.path}`;
    }

    case "run_shell": {
      if (!input.command) return "Error: command is required";
      const argv = parseCommandArgs(String(input.command).trim());
      if (argv.length === 0) return "Error: empty command";
      const [cmd, ...args] = argv;
      const proc = Bun.spawn([cmd!, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: CWD,
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const out = stdout + (stderr ? `\nstderr: ${stderr}` : "");
      return exitCode !== 0 ? `[exit ${exitCode}]\n${out}` : out;
    }

    case "list_dir": {
      const dirPath = input.path ? String(input.path) : ".";
      const safePath = await assertWithinCwd(dirPath);
      return readdirSync(safePath).join("\n");
    }

    case "get_system_metrics": {
      const m = await getSystemMetrics();
      return JSON.stringify(m, null, 2);
    }

    case "get_docker_status": {
      const d = await getDockerStatus();
      return JSON.stringify(d, null, 2);
    }

    case "get_docker_logs": {
      if (!input.container) return "Error: container is required";
      const result = await getDockerLogs(
        String(input.container),
        input.lines !== undefined ? Number(input.lines) : undefined,
        input.since !== undefined ? String(input.since) : undefined
      );
      return result.truncated ? `${result.logs}\n[Note: output truncated at 10KB]` : result.logs;
    }

    case "get_git_status": {
      const g = await getGitStatus();
      return JSON.stringify(g, null, 2);
    }

    case "get_process_list": {
      const sortBy = input.sort_by === "mem" ? "mem" : "cpu";
      const limit = input.limit !== undefined ? Number(input.limit) : undefined;
      const pl = await getProcessList(sortBy, limit);
      return JSON.stringify(pl, null, 2);
    }
  }

  throw new Error(`Unknown tool: ${name}`);
}

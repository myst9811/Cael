import { $ } from "bun";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import type { ToolDefinition } from "./providers/types";
import { getSystemMetrics } from "./collectors/system";
import { getDockerStatus, getDockerLogs } from "./collectors/docker";
import { getGitStatus } from "./collectors/git";
import { getProcessList } from "./collectors/process";

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
    description: "Execute a shell command and return stdout",
    input_schema: {
      type: "object",
      properties: { command: { type: "string", description: "Shell command to run" } },
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

export async function executeToolWithTimeout(
  name: string,
  input: Record<string, any>,
  timeoutMs = TOOL_TIMEOUT_MS
): Promise<string> {
  return Promise.race([
    executeTool(name, input),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Tool "${name}" timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

export async function executeTool(name: string, input: Record<string, any>): Promise<string> {
  switch (name) {
    case "read_file":
      if (!input.path) return "Error: path is required";
      return readFileSync(input.path, "utf-8");

    case "write_file":
      if (!input.path || !input.content) return "Error: path and content are required";
      writeFileSync(input.path, input.content);
      return `Written to ${input.path}`;

    case "run_shell":
      if (!input.command) return "Error: command is required";
      return await $`sh -c ${input.command}`.text();

    case "list_dir":
      return readdirSync(input.path ?? ".").join("\n");

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
      const result = await getDockerLogs(input.container, input.lines, input.since);
      return result.truncated ? `${result.logs}\n[Note: output truncated at 10KB]` : result.logs;
    }

    case "get_git_status": {
      const g = await getGitStatus();
      return JSON.stringify(g, null, 2);
    }

    case "get_process_list": {
      const pl = await getProcessList(input.sort_by, input.limit);
      return JSON.stringify(pl, null, 2);
    }
  }

  throw new Error(`Unknown tool: ${name}`);
}

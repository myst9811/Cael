import { $ } from "bun";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import type { ToolDefinition } from "./providers/types";

export const tools: ToolDefinition[] = [
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

export async function executeTool(name: string, input: Record<string, string | undefined>): Promise<string> {
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
      const result = await $`sh -c ${input.command}`.text();
      return result;

    case "list_dir":
      return readdirSync(input.path ?? ".").join("\n");
  }

  return `Unknown tool: ${name}`; // outside switch — TS is satisfied
}

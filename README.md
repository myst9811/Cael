# Cael

A lightweight, model-agnostic AI agent for the terminal. Built with Bun, for fun.

> ⚠️ This is a hobby project. If you need a serious AI coding assistant, use [Claude Code](https://claude.ai/code), [Cursor](https://cursor.sh), or [Copilot](https://github.com/features/copilot). Cael exists to explore what a minimal, hackable, model-agnostic agent can do in ~200 lines of Bun.

---

## What it is right now

A terminal agent that can read/write files, run shell commands, and talk to any LLM — Anthropic, OpenAI, or local models via Ollama. One binary, no cloud dependency, no magic.

## What it's becoming

Most AI tools give you a chat interface bolted onto your editor. Cael is going in a different direction: **a live DevOps dashboard with an AI brain**.

```
╔════════════════════════════════════════════════════╗
║  cael watch                              [q] quit  ║
╠══════════════╦═════════════════╦══════════════════╣
║  SYSTEM      ║  DOCKER         ║  GIT             ║
║  CPU  47%    ║  ● api       UP ║  branch: main    ║
║  MEM  6.2GB  ║  ● db        UP ║  ↑2 unpushed     ║
║  DISK 78%    ║  ✕ worker  DOWN ║  3 files dirty   ║
╠══════════════╩═════════════════╩══════════════════╣
║  ⚠ worker container exited 4 min ago             ║
║  💬 Ask Cael: why did worker crash?  _            ║
╚═══════════════════════════════════════════════════╝
```

The idea: instead of passively showing you metrics, Cael watches your system and lets you *ask questions about it* in plain English. Press `/`, type your question, get a reasoned answer grounded in the actual live state of your machine.

### Planned: `cael watch`

Real-time terminal dashboard monitoring:
- Docker container health + logs
- CPU, memory, disk usage
- Git branch, dirty files, unpushed commits
- Running processes sorted by resource usage

With an AI layer that can answer:
- *"why did that container crash?"* → reads logs, reasons about it
- *"what's eating all my memory?"* → correlates process list with metrics
- *"is it safe to deploy right now?"* → checks git status, disk, running jobs

### Planned: `cael deploy-check`

Runs all collectors, scores your system 0–100, gives a go/no-go with plain-English reasoning before you push to prod.

### Planned: `cael postmortem`

When something crashes, reads logs + git history + process state and drafts the incident report automatically.

---

## Install

```bash
bun install
```

## Setup

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
# Ollama needs no key — just have it running locally
```

## Usage

**One-shot**
```bash
bun run index.ts --provider anthropic:claude-sonnet-4-6 "find all TODOs in this project"
bun run index.ts --provider openai:gpt-4o "refactor utils.ts"
bun run index.ts --provider ollama:llama3.2 "list files and summarize each"
```

**Interactive REPL**
```bash
bun run index.ts --provider anthropic:claude-sonnet-4-6
# cael> your task here
```

**OpenRouter** (200+ models, no extra code)
```bash
OPENAI_BASE_URL=https://openrouter.ai/api/v1 \
  bun run index.ts --provider openai:meta-llama/llama-3.1-8b-instruct "your task"
```

## Providers

| Provider | Format | Example |
|---|---|---|
| Anthropic | `anthropic:<model>` | `anthropic:claude-sonnet-4-6` |
| OpenAI | `openai:<model>` | `openai:gpt-4o` |
| Ollama | `ollama:<model>` | `ollama:llama3.2` |

## Tools

| Tool | Description |
|---|---|
| `read_file` | Read a file from disk |
| `write_file` | Write content to a file |
| `run_shell` | Execute a shell command |
| `list_dir` | List files in a directory |

## Stack

- [Bun](https://bun.sh) — runtime, shell execution, file APIs
- [Anthropic SDK](https://github.com/anthropic-ai/anthropic-sdk-typescript)
- [OpenAI SDK](https://github.com/openai/openai-node)
- Ollama — local models via HTTP

---

*Built for learning. Contributions welcome if you want to hack on it.*

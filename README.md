![Cael](assets/logo.png)

# Cael

Cael is a local DevOps AI agent for inspecting the machine you are running it on.

It can read system metrics, Docker state, process lists, git status, logs, service state, listening ports, and files inside the current working directory. It uses an LLM provider to answer operational questions, run deploy checks, and draft postmortems from local context.

## Install

Download the binary for your platform from the [latest release](https://github.com/myst9811/Cael/releases/latest).

**macOS (Apple Silicon)**

```bash
curl -L https://github.com/myst9811/Cael/releases/latest/download/cael-darwin-arm64 -o cael
chmod +x cael && xattr -dr com.apple.quarantine cael
sudo mv cael /usr/local/bin/cael
```

**macOS (Intel)**

```bash
curl -L https://github.com/myst9811/Cael/releases/latest/download/cael-darwin-x64 -o cael
chmod +x cael && xattr -dr com.apple.quarantine cael
sudo mv cael /usr/local/bin/cael
```

**Linux (x86_64)**

```bash
curl -L https://github.com/myst9811/Cael/releases/latest/download/cael-linux-x64 -o cael
chmod +x cael && sudo mv cael /usr/local/bin/cael
```

**Linux (ARM64)**

```bash
curl -L https://github.com/myst9811/Cael/releases/latest/download/cael-linux-arm64 -o cael
chmod +x cael && sudo mv cael /usr/local/bin/cael
```

On macOS, `xattr -dr com.apple.quarantine cael` removes the quarantine flag added to downloaded binaries.

## Setup

Configure a provider:

```bash
cael config set provider anthropic:claude-sonnet-4-6
```

Or set it per shell:

```bash
export CAEL_PROVIDER=anthropic:claude-sonnet-4-6
```

Set the API key for the provider you use:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

Ollama does not require an API key.

Check your setup:

```bash
cael doctor
```

## Usage

```bash
cael [--provider <provider:model>] <command> [args]
```

If no command is provided, Cael starts an interactive REPL.

### Ask

Run one question and exit:

```bash
cael ask "what process is using the most memory right now?"
cael ask "why is disk usage high?"
cael ask "what changed in git recently?"
```

### Watch

Start the live terminal dashboard:

```bash
cael watch
```

`watch` refreshes local system, Docker, and git state every 5 seconds. Press `/` to ask a question inside the dashboard. Follow-up questions keep the conversation history for the current session.

The watch agent can read files and run a limited read-only shell allowlist. It cannot write files.

### Deploy Check

Score whether the current system looks safe to deploy:

```bash
cael deploy-check
```

The check uses system metrics, Docker status, git status, and deploy policy thresholds. It prints a score table and a short LLM-generated assessment.

Policy files are read from `.cael/policy.json` and `~/.cael/config.json`. Project policy overrides user policy.

Use it as a deploy gate:

```bash
cael deploy-check && ./deploy.sh
```

### Postmortem

Draft a markdown postmortem from local incident context:

```bash
cael postmortem --since 2h
cael postmortem --container api --since 30m
cael postmortem --since 2026-06-30T14:00:00Z --output postmortem.md
```

Postmortem generation can use Docker logs, Docker inspect data, git status, process state, system metrics, and a timeline extracted from the collected context.

Template order:

1. `--template <path>`
2. `.cael/postmortem-template.md`
3. Built-in default template

### Config

```bash
cael config show
cael config set provider anthropic:claude-sonnet-4-6
```

Configuration is stored in `~/.cael/config.json`.

Provider precedence:

1. `--provider` flag
2. `CAEL_PROVIDER`
3. `cael config set provider <spec>`

### Update

```bash
cael update
```

Checks GitHub releases and installs the latest Cael binary for the current platform.

## Providers

| Provider | Example |
|---|---|
| Anthropic | `anthropic:claude-sonnet-4-6` |
| OpenAI | `openai:gpt-4o` |
| Ollama | `ollama:llama3` |
| OpenAI-compatible endpoint | `openai:<model>` with `OPENAI_BASE_URL` set |

Examples:

```bash
cael --provider anthropic:claude-sonnet-4-6 ask "is this host healthy?"
cael --provider openai:gpt-4o deploy-check
cael --provider ollama:llama3 ask "summarize the current git state"
```

## What Cael Can Read

| Tool | Reads |
|---|---|
| `get_system_metrics` | CPU, memory, disk, inode usage, load average |
| `get_process_list` | Running processes sorted by CPU or memory |
| `get_process_tree` | Parent and child process relationships |
| `get_docker_status` | Docker daemon status and containers |
| `get_docker_logs` | Recent logs from a named container |
| `get_docker_log_patterns` | Repeated patterns in container logs |
| `get_git_status` | Branch, dirty files, unpushed commits, behind commits |
| `get_listening_ports` | TCP and UDP listening ports |
| `get_runtime_services` | systemd, launchctl, and docker-compose services |
| `read_file` | Files inside the current working directory |
| `list_dir` | Directories inside the current working directory |
| `run_shell` | Commands executed directly without shell expansion |

File and directory tools are restricted to the current working directory. Tool output is truncated and secret-like values are redacted where applicable.

## Command Permissions

The normal agent and REPL include `write_file`.

`cael watch` excludes `write_file` and restricts `run_shell` to read-only commands. Docker and git subcommands are also limited in watch mode.

Globally blocked destructive commands include disk-formatting and wiping tools such as `dd`, `mkfs`, `shred`, `wipefs`, `fdisk`, `parted`, `gdisk`, and `diskutil`.

## Development

This project uses Bun.

Install dependencies:

```bash
bun install
```

Run tests:

```bash
bun test
```

Build the current platform binary:

```bash
bun run build
```

Build all release binaries:

```bash
bun run build:all
```

## Stack

- Bun runtime and test runner
- TypeScript
- Anthropic SDK
- OpenAI SDK
- ANSI terminal UI

![Cael](assets/logo.png)

You're on-call. A container keeps restarting. You have five tabs open — Grafana, CloudWatch, a Docker shell, a Slack thread, and the runbook nobody's touched since 2023. You already know the answer is in there somewhere.

**Cael collapses those tabs into one question.**

```
> why does the api container keep restarting?

⟳ calling get_docker_logs...

The api container has OOMKilled 3 times in the last hour. It's
running with no memory limit set, and the process list shows it
consuming 2.1 GB — the host only has 3.8 GB free. Set a memory
limit on the container or increase the instance size before the
next deploy.
```

No copy-pasting logs. No switching context. Cael reads your live system state and reasons about it — Docker logs, process list, git status, disk and CPU — then tells you what it found.

---

## The pitch for your workflow

Cael isn't trying to replace Datadog or replace your runbooks. It's the **first step** when something goes wrong or you need a quick read before a deploy:

| Situation | What you do now | With Cael |
|---|---|---|
| Container keeps crashing | Open logs, grep, check metrics, cross-reference | `cael watch` → press `/` → ask |
| Pre-deploy sanity check | Check git, check CPU, check running jobs, guess | `cael deploy-check` → scored verdict |
| Writing a postmortem | Reconstruct the timeline manually | `cael postmortem` → draft in seconds |
| New service, no idea what it does | Read the code, ask a colleague | `cael ask "what is this service doing right now?"` |
| Oncall handoff | Write a status update from memory | Ask Cael, paste the answer |

---

## `cael watch` — always-on dashboard with an agent inside

```
╔══════════════════════════════════════════════════════════════╗
║  cael watch   02:14 AM         [/] ask          [q] quit    ║
╠══════════════════╦═══════════════════╦═══════════════════════╣
║  SYSTEM          ║  DOCKER           ║  GIT                 ║
║    CPU   78%     ║    daemon running ║    hotfix/payment    ║
║    MEM   14.1GB  ║    api       ● UP ║    0 untracked       ║
║    DISK  91%     ║    worker    ✕ -- ║    2 unpushed        ║
║    LOAD  6.20    ║    db        ● UP ║                      ║
╠══════════════════╩═══════════════════╩═══════════════════════╣
║  ⚠ Disk 91% full  ⚠ CPU 78% high                           ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  > is it safe to push this hotfix right now?                ║
║                                                              ║
║  ⟳ calling get_git_status...                                ║
║                                                              ║
║  Disk is at 91% — a deploy that writes logs or build        ║
║  artifacts could push it to 100% and bring the host down.  ║
║  CPU is also elevated at 78%. The worker container is       ║
║  stopped. I'd resolve disk and worker first, then deploy.   ║
║                                                              ║
║  [↑↓] scroll · [any other key] dismiss                      ║
╚══════════════════════════════════════════════════════════════╝
```

Dashboard refreshes every 5 seconds. Press `/` to ask a question. The agent actually runs tools — checks the process list, reads Docker logs, inspects git — then gives you an answer grounded in your real current state, not its training data.

Conversation persists in the session, so follow-ups work:

```
> which process is eating the disk?
> okay killed it, is the deploy safe now?
> what changed in the last 3 commits?
```

---

## `cael deploy-check` — go / no-go in 5 seconds

Run it before every push. Takes a snapshot, scores it, tells you why.

```
╔══════════════════════════════════════════════════════════════╗
║  DEPLOY CHECK                               score: 61/100   ║
╠══════════════════════════════════════════════════════════════╣
║  ✓  CPU nominal                  (12%)                      ║
║  ✓  Memory OK                    (58%)                      ║
║  ✕  Disk critical                (91%) ← fix this first     ║
║  ⚠  2 unpushed commits                                      ║
║  ✕  worker container stopped                                ║
╠══════════════════════════════════════════════════════════════╣
║  Verdict: NO-GO. Disk is near capacity and a container is   ║
║  down. Resolve both before deploying to avoid a bad deploy  ║
║  making an already degraded system worse.                   ║
╚══════════════════════════════════════════════════════════════╝
```

Wire it into your deploy script to make it a hard gate:

```bash
cael deploy-check && ./deploy.sh
```

---

## `cael postmortem` — draft the incident report automatically

```bash
cael --provider anthropic:claude-opus-4-8 postmortem "api down 02:00–02:47"
```

Reads logs, git history, and process state from the incident window. Outputs a structured draft: timeline, probable cause, contributing factors, action items. You review, you edit, you ship it — no starting from a blank page at 4am.

---

## `cael ask` — one-shot, no dashboard

For when you just need an answer fast:

```bash
cael ask "what process is using the most memory right now?"
cael ask "did anything get deployed in the last 2 hours?"
cael ask "why is load average spiking?"
```

Same agent, same tools, no TUI. Pipe it anywhere.

---

## REPL — extended investigation session

```bash
cael --provider anthropic:claude-opus-4-8
# cael> walk me through what this service is doing
# cael> which of those containers has the most restarts in the last day?
# cael> show me the last 50 lines of the worker logs
# cael> is there anything in git that explains this behaviour?
```

Full tool access. Multi-turn. History persists until you exit.

---

## Install

Download the binary for your platform from the [latest release](https://github.com/myst9811/Cael/releases/latest):

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

> **macOS note:** The `xattr` command removes the quarantine flag macOS applies to binaries downloaded from the internet. Run it once after downloading.

Then set at least one API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # Claude
export OPENAI_API_KEY=sk-...          # GPT-4o, etc.
# Ollama: nothing — runs 100% local, no key needed
```

---

## Providers

Anything that speaks OpenAI-compatible is a one-liner:

| Provider | Flag | Notes |
|---|---|---|
| Anthropic | `--provider anthropic:claude-opus-4-8` | Best reasoning |
| OpenAI | `--provider openai:gpt-4o` | |
| Ollama | `--provider ollama:llama3.2` | Fully local, no API key |
| OpenRouter | `--provider openai:<any-model>` + `OPENAI_BASE_URL=https://openrouter.ai/api/v1` | 200+ models |

If you're in an air-gapped environment or have data residency requirements, Ollama gives you everything locally — no data leaves the machine.

---

## What the agent can see

| Tool | What it reads |
|---|---|
| `get_system_metrics` | CPU, memory, disk, load average |
| `get_process_list` | Running processes sorted by CPU or RAM |
| `get_docker_status` | All containers and their health |
| `get_docker_logs` | Recent logs from any named container |
| `get_git_status` | Branch, dirty files, unpushed commits |
| `read_file` | Any file on disk |
| `run_shell` | Runs a command and returns the output |
| `list_dir` | Directory listing |

The watch dashboard agent has no `write_file` — it's read-only by design. The full REPL has write access.

---

## Stack

- **[Bun](https://bun.sh)** — runtime, built-in SQLite, shell, test runner. No Node.
- **[Anthropic SDK](https://github.com/anthropic-ai/anthropic-sdk-typescript)** — streaming, tool use
- **[OpenAI SDK](https://github.com/openai/openai-node)** — OpenAI + any compatible endpoint
- Pure ANSI TUI — no ncurses, no external UI framework

---

## Tests

```bash
bun test
```

165 tests, no network calls, no mocks of the LLM. Fast.

---

> Cael doesn't know your infrastructure better than you do. It just stops you from having to hold it all in your head at 2am.

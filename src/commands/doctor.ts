import { resolveProvider } from "../config";

interface CheckResult {
  ok: boolean;
  detail: string;
}

interface Check {
  label: string;
  check: () => Promise<CheckResult>;
}

export function buildChecks(configPath?: string): Check[] {
  return [
    {
      label: "Provider configured",
      check: async () => {
        const p = await resolveProvider(configPath);
        if (p) return { ok: true, detail: p };
        return {
          ok: false,
          detail: "not set — run: cael config set provider anthropic:claude-sonnet-4-6",
        };
      },
    },
    {
      label: "ANTHROPIC_API_KEY",
      check: async () => {
        const p = await resolveProvider(configPath);
        if (p && !p.startsWith("anthropic")) return { ok: true, detail: "not using anthropic" };
        const key = process.env.ANTHROPIC_API_KEY;
        if (key) return { ok: true, detail: `set (${key.slice(0, 8)}...)` };
        return { ok: false, detail: "missing — export ANTHROPIC_API_KEY=sk-ant-..." };
      },
    },
    {
      label: "OPENAI_API_KEY",
      check: async () => {
        const p = await resolveProvider(configPath);
        if (p && !p.startsWith("openai")) return { ok: true, detail: "not using openai" };
        const key = process.env.OPENAI_API_KEY;
        if (key) return { ok: true, detail: `set (${key.slice(0, 8)}...)` };
        return { ok: false, detail: "missing — export OPENAI_API_KEY=sk-..." };
      },
    },
    {
      label: "Docker daemon",
      check: async () => {
        try {
          const proc = Bun.spawn(["docker", "info"], { stdout: "pipe", stderr: "pipe" });
          const code = await proc.exited;
          return code === 0
            ? { ok: true, detail: "running" }
            : { ok: false, detail: "daemon not running — start Docker Desktop or dockerd" };
        } catch {
          return { ok: false, detail: "docker not found in PATH" };
        }
      },
    },
    {
      label: "Git",
      check: async () => {
        try {
          const proc = Bun.spawn(["git", "--version"], { stdout: "pipe", stderr: "pipe" });
          const [code, out] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
          return code === 0
            ? { ok: true, detail: out.trim() }
            : { ok: false, detail: "git returned error" };
        } catch {
          return { ok: false, detail: "git not found in PATH" };
        }
      },
    },
  ];
}

export async function runDoctor(configPath?: string): Promise<void> {
  console.log("Cael doctor — checking dependencies and configuration\n");
  const checks = buildChecks(configPath);
  let allOk = true;
  for (const { label, check } of checks) {
    const { ok, detail } = await check();
    const icon = ok ? "✓" : "✗";
    console.log(`  ${icon}  ${label.padEnd(24)} ${detail}`);
    if (!ok) allOk = false;
  }
  console.log("");
  if (allOk) {
    console.log("All checks passed.");
  } else {
    console.log("Some checks failed — see above for remediation steps.");
  }
}

import { visLen } from "./draw";

// ── Inline markdown → ANSI ────────────────────────────────────────────────────

function inlineMarkdown(text: string): string {
  return text
    // Code spans first — must run before bold/italic to avoid processing inside them
    .replace(/`([^`]+)`/g, "\x1b[38;5;222m$1\x1b[0m")
    // Strip markdown links — keep display text only
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Bold
    .replace(/\*\*([^*]+)\*\*/g, "\x1b[1m$1\x1b[0m")
    // Italic (single asterisk, not touching bold)
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "\x1b[2m$1\x1b[0m");
}

// ── Word-wrap (ANSI-aware) ────────────────────────────────────────────────────

function wrapLine(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!w) continue;
    if (cur && visLen(cur) + 1 + visLen(w) > width) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

// ── Block-level renderer ──────────────────────────────────────────────────────

export function renderMarkdown(text: string, width: number): string[] {
  const out: string[] = [];

  for (const raw of text.split("\n")) {
    // Question prefix lines (written by watch.ts as "> question")
    if (raw.startsWith("> ")) {
      const content = inlineMarkdown(raw.slice(2));
      out.push(`\x1b[32m>\x1b[0m \x1b[1m${content}\x1b[0m`);
      continue;
    }

    // H3
    if (raw.startsWith("### ")) {
      out.push(`\x1b[1m\x1b[36m${inlineMarkdown(raw.slice(4))}\x1b[0m`);
      continue;
    }

    // H2
    if (raw.startsWith("## ")) {
      out.push(`\x1b[1m${inlineMarkdown(raw.slice(3))}\x1b[0m`);
      continue;
    }

    // H1
    if (raw.startsWith("# ")) {
      out.push(`\x1b[1m${inlineMarkdown(raw.slice(2))}\x1b[0m`);
      continue;
    }

    // Horizontal rules — either --- or ──── (the separator watch.ts inserts)
    if (/^---+$/.test(raw) || /^─{3,}$/.test(raw)) {
      out.push(`\x1b[2m${"─".repeat(Math.min(width, 40))}\x1b[0m`);
      continue;
    }

    // Bullet points
    if (raw.startsWith("- ") || raw.startsWith("* ")) {
      const content = inlineMarkdown(raw.slice(2));
      const bulletWidth = Math.max(width - 4, 10);
      const wrapped = wrapLine(content, bulletWidth);
      out.push(`  \x1b[36m•\x1b[0m ${wrapped[0] ?? ""}`);
      for (let i = 1; i < wrapped.length; i++) {
        out.push(`    ${wrapped[i]}`);
      }
      continue;
    }

    // Blank line → spacing
    if (raw.trim() === "") {
      out.push("");
      continue;
    }

    // Plain paragraph — inline markdown then word-wrap
    for (const line of wrapLine(inlineMarkdown(raw), width)) {
      out.push(line);
    }
  }

  return out;
}

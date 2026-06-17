// cael-logo.ts — startup banner for Cael, the DevOps terminal agent.
//
// Concept: a core node (◆) tracked by satellites (✦) on an open orbit — reads
// at once as a constellation (cael = sky) and as a system topology under watch.
// The wordmark carries a flowing indigo → cyan → green gradient: sky → signal →
// healthy/live. Degrades gracefully to plain text under NO_COLOR / dumb terminals.

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const COLOR =
  !process.env.NO_COLOR &&
  process.stdout.isTTY !== false &&
  process.env.TERM !== "dumb";

const fg = (r: number, g: number, b: number): string =>
  COLOR ? `\x1b[38;2;${r};${g};${b}m` : "";
const reset = COLOR ? RESET : "";
const bold = COLOR ? BOLD : "";
const dim = COLOR ? DIM : "";

// ── gradient ────────────────────────────────────────────────────────────────
type RGB = [number, number, number];

const STOPS: RGB[] = [
  [129, 140, 248], // indigo — sky
  [34, 211, 238], //  cyan   — signal
  [52, 211, 153], //  green  — live / healthy
];

function gradientAt(t: number): RGB {
  const span = STOPS.length - 1;
  const s = Math.min(Math.max(t, 0), 1) * span;
  const i = Math.min(Math.floor(s), span - 1);
  const f = s - i;
  const [r1, g1, b1] = STOPS[i]!;
  const [r2, g2, b2] = STOPS[i + 1]!;
  return [
    Math.round(r1 + (r2 - r1) * f),
    Math.round(g1 + (g2 - g1) * f),
    Math.round(b1 + (b2 - b1) * f),
  ];
}

// Glyphs that should glow: rendered bold and lifted toward white.
const ACCENT = new Set(["◆", "✦"]);

// Paint a block of monospace rows with a horizontal gradient that flows across
// the full width, so every line shares one continuous color sweep.
function paint(rows: string[]): string {
  const width = Math.max(...rows.map((r) => [...r].length));
  return rows
    .map((row) => {
      const chars = [...row];
      let out = "";
      for (let x = 0; x < width; x++) {
        const ch = chars[x] ?? " ";
        if (ch === " ") {
          out += " ";
          continue;
        }
        const t = width <= 1 ? 0 : x / (width - 1);
        let [r, g, b] = gradientAt(t);
        if (ACCENT.has(ch)) {
          // lift toward white for a star/core highlight
          r = Math.round(r + (255 - r) * 0.45);
          g = Math.round(g + (255 - g) * 0.45);
          b = Math.round(b + (255 - b) * 0.45);
          out += `${bold}${fg(r, g, b)}${ch}${reset}`;
        } else {
          out += `${fg(r, g, b)}${ch}`;
        }
      }
      return out + reset;
    })
    .join("\n");
}

// ── emblem ────────────────────────────────────────────────────────────────
const ICON = [
  "      ·                  ",
  "    ╭───────╮          ✧  ",
  "  ╭─╯       ╰─╮           ",
  " ✦       ◆       ✦        ",
  "  ╰─╮       ╭─╯           ",
  "    ╰───────╯     ·       ",
];

// ── wordmark (6 rows, 5-wide glyphs, 2-space gaps → 26 cols) ─────────────────
const GLYPH_C = ["█████", "█    ", "█    ", "█    ", "█    ", "█████"];
const GLYPH_A = [" ███ ", "█   █", "█   █", "█████", "█   █", "█   █"];
const GLYPH_E = ["█████", "█    ", "████ ", "█    ", "█    ", "█████"];
const GLYPH_L = ["█    ", "█    ", "█    ", "█    ", "█    ", "█████"];

const GAP = "  ";
const GLYPHS = [GLYPH_C, GLYPH_A, GLYPH_E, GLYPH_L];
const WORDMARK = Array.from({ length: 6 }, (_, i) =>
  GLYPHS.map((g) => g[i]).join(GAP)
);

const TAGLINE = "local · model-agnostic · DevOps terminal agent";

// Center a block of lines to a given width with a left margin.
function block(lines: string[], width: number, margin = "  "): string[] {
  return lines.map((l) => {
    const len = [...l].length;
    const pad = Math.max(0, Math.floor((width - len) / 2));
    return margin + " ".repeat(pad) + l;
  });
}

const WIDTH = Math.max(...WORDMARK.map((r) => [...r].length));

export const LOGO =
  "\n" +
  paint(block(ICON, WIDTH)) +
  "\n\n" +
  paint(WORDMARK.map((l) => "  " + l)) +
  "\n\n" +
  `  ${dim}${TAGLINE}${reset}` +
  "\n";

export function printLogo(): void {
  process.stdout.write(LOGO + "\n");
}

// Number of terminal rows consumed by printLogo() — used by watch to
// compute how many rows remain for the dashboard below the logo.
export const LOGO_ROWS = (LOGO + "\n").split("\n").length - 1;

// Allow `bun src/assets/logo.ts` to preview the banner directly.
if (import.meta.url === `file://${process.argv[1]}`) printLogo();
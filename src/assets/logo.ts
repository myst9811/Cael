const G = "\x1b[92m";   // bright green
const BG = "\x1b[1m\x1b[92m";  // bold bright green
const R = "\x1b[0m";    // reset

// Two tools crossed: wrench head left, shaft diagonal, handle bottom-left
const ICON = `
     ┌──┐
  ───┤  ├──────────────────╮
     └──┘                   │
           ╲      ╭─────────╯
            ╲    ╱
   ┌──────────╲  ╱
   └───────────╲╱
`;

// 4-char letters, 2-char gaps: [C:4][gap:2][A:4][gap:2][E:4][gap:2][L:4]
//   C      A    E    L
//  ` ## `  ` #  ` ` ####` `#   `   (row 1)
//  `#   `  `# # ` `#   ` `#   `   (row 2)
//  `#   `  `####` `### ` `#   `   (row 3)
//  `#   `  `#  #` `#   ` `#   `   (row 4)
//  ` ## `  `#  #` `####` `####`   (row 5)
const WORDMARK = [
  " ##    #    ####  #",
  "#     # #   #     #",
  "#     ####  ###   #",
  "#     #  #  #     #",
  " ##   #  #  ####  ####",
].join("\n");

const TAGLINE = "  local · model-agnostic · DevOps terminal agent";

export const LOGO =
  BG + ICON + "\n" +
  WORDMARK + R +
  G + "\n\n" + TAGLINE + "\n" + R;

export function printLogo(): void {
  process.stdout.write(LOGO + "\n");
}

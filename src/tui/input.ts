type KeyHandler = (key: string) => void;

export function setupRawMode(onKey: KeyHandler): () => void {
  const restore = () => {
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {}
    process.stdout.write("\x1b[?25h"); // show cursor
    process.stdin.pause();
  };

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  const handler = (key: string) => {
    onKey(key);
  };

  process.stdin.on("data", handler);

  return () => {
    process.stdin.removeListener("data", handler);
    restore();
  };
}

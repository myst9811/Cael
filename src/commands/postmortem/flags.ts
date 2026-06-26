export interface PostmortemFlags {
  container?: string;
  since?: string;
  output?: string;
  template?: string;
}

export function parsePostmortemFlags(args: string[]): PostmortemFlags {
  const result: PostmortemFlags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--container" && args[i + 1]) result.container = args[++i];
    else if (args[i] === "--since" && args[i + 1]) result.since = args[++i];
    else if (args[i] === "--output" && args[i + 1]) result.output = args[++i];
    else if (args[i] === "--template" && args[i + 1]) result.template = args[++i];
  }
  return result;
}

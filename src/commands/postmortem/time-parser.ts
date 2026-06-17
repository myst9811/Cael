export function parseTimeSince(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  // ISO / RFC3339 timestamp — starts with YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : s;
  }

  // Day shorthand: Nd → N*24h  (compound like 2d12h not supported)
  if (/^\d+d$/.test(s)) {
    return `${parseInt(s) * 24}h`;
  }

  // Docker-native duration: one or more (digits + h|m|s) with no other chars
  if (/^(\d+[hms])+$/.test(s)) return s;

  return null;
}

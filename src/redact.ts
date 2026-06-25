const SECRET_KEY_NAMES = [
  "API_KEY", "SECRET", "TOKEN", "PASSWORD", "PASSWD", "PRIVATE_KEY",
  "ACCESS_KEY", "ACCESS_TOKEN", "AUTH_TOKEN", "AUTHORIZATION", "CREDENTIAL", "CREDENTIALS",
  "API_SECRET", "APP_SECRET", "CLIENT_SECRET", "DATABASE_URL", "DB_PASSWORD",
  "DB_PASS", "JWT_SECRET", "SIGNING_KEY", "ENCRYPTION_KEY", "PRIVATE_KEY_ID",
  "SECRET_KEY", "AUTH_SECRET", "REFRESH_TOKEN", "ID_TOKEN", "SERVICE_KEY",
];

const KEY_PATTERN = new RegExp(
  `\\b(${SECRET_KEY_NAMES.join("|")})\\s*=\\s*\\S+`,
  "gi"
);

const REDACT_PATTERNS: [RegExp, string][] = [
  [KEY_PATTERN, "$1=[REDACTED]"],
  [/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]"],
  [/-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]"],
  [/\b(postgres|postgresql|mysql|mongodb|redis|amqp|amqps):\/\/[^@\s]+:[^@\s]+@/gi, "$1://[REDACTED]@"],
  [/\b(AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED AWS KEY]"],
];

export function redactSecrets(text: string): string {
  let result = text;
  for (const [pattern, replacement] of REDACT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

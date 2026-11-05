/**
 * One JSON object per line on stdout/stderr, so journald (VM) and Cloud Logging (Cloud Run)
 * can filter by level and field. Values under secret-looking keys are never written.
 */
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|authorization|cookie|private[_-]?key|refresh/i;
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack?.split("\n").slice(0, 8).join("\n") };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Fields = {};
  for (const [k, v] of Object.entries(value as Fields)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  return out;
}

function minLevel(): number {
  const l = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
  return ORDER[l] ?? ORDER.info;
}

function write(level: Level, msg: string, fields?: Fields | unknown) {
  if (ORDER[level] < minLevel()) return;
  const extra = fields instanceof Error ? { error: redact(fields) } : fields && typeof fields === "object" ? (redact(fields) as Fields) : fields === undefined ? {} : { detail: fields };
  // An error with a stack is marked for Google Cloud Error Reporting, which groups and counts them
  // from Cloud Logging with no SDK. On the VM the same lines land in journald.
  const err = (extra as { error?: { stack?: string; message?: string } }).error;
  const reported =
    level === "error" && err?.stack
      ? { "@type": "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent", stack_trace: err.stack, serviceContext: { service: process.env.K_SERVICE ?? process.env.SERVICE_NAME ?? "bodh" } }
      : {};
  // `severity` is the field Cloud Logging reads; `level` is for humans and jq.
  const line = JSON.stringify({ time: new Date().toISOString(), level, severity: level.toUpperCase(), msg, ...extra, ...reported });
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const log = {
  debug: (msg: string, fields?: Fields | unknown) => write("debug", msg, fields),
  info: (msg: string, fields?: Fields | unknown) => write("info", msg, fields),
  warn: (msg: string, fields?: Fields | unknown) => write("warn", msg, fields),
  error: (msg: string, fields?: Fields | unknown) => write("error", msg, fields),
};

import { afterEach, describe, expect, it, vi } from "vitest";
import { log, redact } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("redact", () => {
  it("blanks secret-looking keys at any depth and keeps the rest", () => {
    expect(redact({ job: "hourly", headers: { Authorization: "Bearer abc", "x-worker-token": "t" }, refresh_token: "r", apiKey: "k", rows: 3 })).toEqual({
      job: "hourly",
      headers: { Authorization: "[redacted]", "x-worker-token": "[redacted]" },
      refresh_token: "[redacted]",
      apiKey: "[redacted]",
      rows: 3,
    });
  });

  it("turns errors into name, message and a short stack", () => {
    const r = redact(new TypeError("boom")) as { name: string; message: string };
    expect(r.name).toBe("TypeError");
    expect(r.message).toBe("boom");
  });
});

describe("log", () => {
  it("writes one JSON line with level and severity", () => {
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    log.info("worker listening", { port: 8787, token: "nope" });
    const line = JSON.parse(String(out.mock.calls[0]![0]));
    expect(line).toMatchObject({ level: "info", severity: "INFO", msg: "worker listening", port: 8787, token: "[redacted]" });
  });

  it("sends errors to stderr, marked for Cloud Error Reporting", () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    log.error("failed", new Error("x"));
    const line = JSON.parse(String(err.mock.calls[0]![0]));
    expect(line).toMatchObject({ level: "error", severity: "ERROR", error: { message: "x" }, "@type": expect.stringContaining("ReportedErrorEvent") });
    expect(line.stack_trace).toContain("Error: x");
  });
});

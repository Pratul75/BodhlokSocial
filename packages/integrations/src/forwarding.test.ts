import { describe, expect, it, vi } from "vitest";
import { rejectedConversions } from "./google-ads";

// pipeline.ts imports the database client; the bisecting sender itself needs none of it.
vi.mock("@bodh/db", () => ({ db: {}, sql: () => ({}), conversionEvents: {}, conversionForwards: {}, adSpendDaily: {}, webSessionsDaily: {}, pipelineRuns: {}, connections: {}, reconcileAttribution: vi.fn(), rebuildFunnel: vi.fn() }));
const { sendCapiBisecting } = await import("./pipeline");

type Row = Parameters<typeof sendCapiBisecting>[1][number];
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ f: { id: `f${i}`, attempts: 0 }, e: { eventId: `e${i}` } }) as unknown as Row);
const metaError = (status: number) => Object.assign(new Error(`Meta API ${status}: bad event`), { retryable: status === 429 || status >= 500 });

describe("sendCapiBisecting", () => {
  it("sends a good batch in one call", async () => {
    const send = vi.fn(async () => undefined);
    const r = await sendCapiBisecting(send, rows(8));
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.sent).toHaveLength(8);
    expect(r.rejected).toEqual([]);
  });

  it("isolates the one event Meta refuses and sends the rest", async () => {
    const send = vi.fn(async (batch: Row[]) => {
      if (batch.some((b) => b.f.id === "f5")) throw metaError(400);
    });
    const r = await sendCapiBisecting(send, rows(8));
    expect(r.sent.map((s) => s.f.id).sort()).toEqual(["f0", "f1", "f2", "f3", "f4", "f6", "f7"]);
    expect(r.rejected.map((x) => x.row.f.id)).toEqual(["f5"]);
    expect(r.rejected[0]!.error).toMatch(/Meta API 400/);
    expect(send.mock.calls.length).toBeLessThanOrEqual(8);
  });

  it("does not split on a retryable error: the whole batch waits", async () => {
    const send = vi.fn(async () => {
      throw metaError(503);
    });
    await expect(sendCapiBisecting(send, rows(8))).rejects.toThrow("503");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops calling when the budget runs out and leaves the rest queued, not failed", async () => {
    const send = vi.fn(async () => {
      throw metaError(400);
    });
    const r = await sendCapiBisecting(send, rows(500), { calls: 5 });
    expect(send).toHaveBeenCalledTimes(5);
    expect(r.sent).toEqual([]);
    expect(r.rejected).toEqual([]);
    expect(r.deferred).toHaveLength(500);
  });
});

describe("rejectedConversions", () => {
  it("maps Google's partial-failure locations to request indexes", () => {
    const m = rejectedConversions({
      message: "2 errors",
      details: [
        {
          errors: [
            { message: "The click is too old.", location: { fieldPathElements: [{ fieldName: "conversions", index: 1 }, { fieldName: "gclid" }] } },
            { message: "Duplicate order id.", location: { fieldPathElements: [{ fieldName: "conversions", index: 4 }] } },
          ],
        },
      ],
    });
    expect([...m]).toEqual([
      [1, "The click is too old."],
      [4, "Duplicate order id."],
    ]);
  });

  it("returns nothing for no error or one without locations", () => {
    expect(rejectedConversions(null).size).toBe(0);
    expect(rejectedConversions({ message: "x", details: [{ errors: [{ message: "y" }] }] }).size).toBe(0);
  });
});

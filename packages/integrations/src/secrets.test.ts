import { describe, expect, it } from "vitest";
import { gcpStore, type SecretManagerLike } from "./secrets";

/** In-memory stand-in for Secret Manager with the same not-found behaviour. */
function fakeClient() {
  const secrets = new Map<string, { versions: { name: string; data: Buffer; state: string }[] }>();
  const nf = () => Object.assign(new Error("not found"), { code: 5 });
  const client: SecretManagerLike = {
    async getSecret({ name }) {
      if (!secrets.has(name)) throw nf();
      return [{}];
    },
    async createSecret({ parent, secretId }) {
      secrets.set(`${parent}/secrets/${secretId}`, { versions: [] });
      return [{}];
    },
    async addSecretVersion({ parent, payload }) {
      const s = secrets.get(parent)!;
      const v = { name: `${parent}/versions/${s.versions.length + 1}`, data: payload.data, state: "ENABLED" };
      s.versions.push(v);
      return [{ name: v.name }];
    },
    async accessSecretVersion({ name }) {
      const parent = name.replace(/\/versions\/latest$/, "");
      const s = secrets.get(parent);
      const v = s?.versions.filter((x) => x.state === "ENABLED").at(-1);
      if (!v) throw nf();
      return [{ payload: { data: v.data } }];
    },
    async listSecretVersions({ parent }) {
      return [(secrets.get(parent)?.versions ?? []).filter((v) => v.state !== "DESTROYED").map((v) => ({ name: v.name }))];
    },
    async destroySecretVersion({ name }) {
      for (const s of secrets.values()) for (const v of s.versions) if (v.name === name) v.state = "DESTROYED";
      return [{}];
    },
    async deleteSecret({ name }) {
      if (!secrets.delete(name)) throw nf();
      return [{}];
    },
  };
  return { client, secrets };
}

describe("gcpStore", () => {
  it("creates the secret on first save and reads it back", async () => {
    const { client } = fakeClient();
    const store = gcpStore(client, "bodh-prod");
    expect(await store.put("integration-anthropic", "sk-1")).toBe("gcp:projects/bodh-prod/secrets/integration-anthropic");
    expect(await store.get("integration-anthropic")).toBe("sk-1");
  });

  it("keeps only the newest version when a key is replaced", async () => {
    const { client, secrets } = fakeClient();
    const store = gcpStore(client, "p");
    await store.put("integration-x", "old");
    await store.put("integration-x", "new");
    expect(await store.get("integration-x")).toBe("new");
    const states = secrets.get("projects/p/secrets/integration-x")!.versions.map((v) => v.state);
    expect(states).toEqual(["DESTROYED", "ENABLED"]);
  });

  it("returns null for missing secrets and tolerates removing them", async () => {
    const store = gcpStore(fakeClient().client, "p");
    expect(await store.get("integration-none")).toBeNull();
    await expect(store.remove("integration-none")).resolves.toBeUndefined();
  });

  it("rejects names that could escape the project path", async () => {
    const store = gcpStore(fakeClient().client, "p");
    await expect(store.put("../other-project", "x")).rejects.toThrow("Invalid secret name");
  });
});

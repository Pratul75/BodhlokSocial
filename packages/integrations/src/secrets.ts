import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

/**
 * Where integration secrets live. The database stores only a reference to the secret.
 * - local: one file per secret under <repo>/.secrets (gitignored, mode 0600). Development only.
 * - gcp:   GCP Secret Manager. Each integration gets one secret; each save adds a version
 *          and destroys the older ones, so a replaced key stops working everywhere.
 */
export interface SecretStore {
  put(name: string, value: string): Promise<string>;
  get(name: string): Promise<string | null>;
  remove(name: string): Promise<void>;
}

const NAME_RE = /^[a-zA-Z0-9_-]{1,255}$/;
function checkName(name: string) {
  if (!NAME_RE.test(name)) throw new Error(`Invalid secret name: ${name}`);
}

// Both apps run with their own folder as cwd, so the repo root is two levels up.
const LOCAL_DIR = process.env.SECRETS_DIR ?? resolve(process.cwd(), "../../.secrets");

export const localStore: SecretStore = {
  async put(name, value) {
    checkName(name);
    await mkdir(LOCAL_DIR, { recursive: true, mode: 0o700 });
    await writeFile(join(LOCAL_DIR, basename(name)), value, { mode: 0o600 });
    return `local:${name}`;
  },
  async get(name) {
    checkName(name);
    try {
      return await readFile(join(LOCAL_DIR, basename(name)), "utf8");
    } catch {
      return null;
    }
  },
  async remove(name) {
    checkName(name);
    await rm(join(LOCAL_DIR, basename(name)), { force: true });
  },
};

/** The subset of SecretManagerServiceClient this store uses, so tests can pass a fake. */
export interface SecretManagerLike {
  getSecret(req: { name: string }): Promise<unknown>;
  createSecret(req: { parent: string; secretId: string; secret: object }): Promise<unknown>;
  addSecretVersion(req: { parent: string; payload: { data: Buffer } }): Promise<[{ name?: string | null }, ...unknown[]]>;
  accessSecretVersion(req: { name: string }): Promise<[{ payload?: { data?: Uint8Array | string | null } | null }, ...unknown[]]>;
  listSecretVersions(req: { parent: string; filter?: string }): Promise<[{ name?: string | null }[], ...unknown[]]>;
  destroySecretVersion(req: { name: string }): Promise<unknown>;
  deleteSecret(req: { name: string }): Promise<unknown>;
}

const NOT_FOUND = 5; // gRPC status code
const isNotFound = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: number }).code === NOT_FOUND;

export function gcpStore(client: SecretManagerLike, projectId: string): SecretStore {
  const secretPath = (name: string) => `projects/${projectId}/secrets/${name}`;
  return {
    async put(name, value) {
      checkName(name);
      const path = secretPath(name);
      try {
        await client.getSecret({ name: path });
      } catch (e) {
        if (!isNotFound(e)) throw e;
        await client.createSecret({
          parent: `projects/${projectId}`,
          secretId: name,
          secret: { replication: { automatic: {} }, labels: { app: "bodh-growth-os" } },
        });
      }
      const [version] = await client.addSecretVersion({ parent: path, payload: { data: Buffer.from(value, "utf8") } });
      const [versions] = await client.listSecretVersions({ parent: path, filter: "state:ENABLED OR state:DISABLED" });
      for (const v of versions) {
        if (v.name && v.name !== version.name) await client.destroySecretVersion({ name: v.name });
      }
      return `gcp:${path}`;
    },
    async get(name) {
      checkName(name);
      try {
        const [res] = await client.accessSecretVersion({ name: `${secretPath(name)}/versions/latest` });
        const data = res.payload?.data;
        if (data == null) return null;
        return typeof data === "string" ? data : Buffer.from(data).toString("utf8");
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async remove(name) {
      checkName(name);
      try {
        await client.deleteSecret({ name: secretPath(name) });
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },
  };
}

let cached: SecretStore | null = null;

export async function secretStore(): Promise<SecretStore> {
  if (cached) return cached;
  if (process.env.SECRETS_BACKEND === "gcp") {
    const projectId = process.env.GCP_PROJECT_ID;
    if (!projectId) throw new Error("GCP_PROJECT_ID must be set when SECRETS_BACKEND=gcp.");
    const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
    cached = gcpStore(new SecretManagerServiceClient() as unknown as SecretManagerLike, projectId);
  } else {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_SECRETS !== "true" && process.env.ALLOW_DEV_AUTH !== "true") {
      throw new Error("Set SECRETS_BACKEND=gcp in production. Local secret files are for development only.");
    }
    cached = localStore;
  }
  return cached;
}

export const secretName = (integrationKey: string) => `integration-${integrationKey}`;

/** Read an integration's stored credential and parse it as JSON, or null if not connected. */
export async function readJsonSecret<T>(integrationKey: string): Promise<T | null> {
  const raw = await (await secretStore()).get(secretName(integrationKey));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

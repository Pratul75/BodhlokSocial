import "server-only";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Where integration secrets live. The database stores only the secret's name.
 * - local: one file per secret under <repo>/.secrets (gitignored, mode 0600)
 * - gcp:   GCP Secret Manager (wired in Phase 1 deployment)
 */
export interface SecretStore {
  put(name: string, value: string): Promise<string>;
  remove(name: string): Promise<void>;
}

const LOCAL_DIR = resolve(process.cwd(), "../../.secrets");

const localStore: SecretStore = {
  async put(name, value) {
    await mkdir(LOCAL_DIR, { recursive: true, mode: 0o700 });
    await writeFile(join(LOCAL_DIR, name), value, { mode: 0o600 });
    return `local:${name}`;
  },
  async remove(name) {
    await rm(join(LOCAL_DIR, name), { force: true });
  },
};

const gcpStore: SecretStore = {
  async put() {
    throw new Error("Secret Manager is not wired up yet. Set SECRETS_BACKEND=local for development.");
  },
  async remove() {
    throw new Error("Secret Manager is not wired up yet.");
  },
};

export function secretStore(): SecretStore {
  return process.env.SECRETS_BACKEND === "gcp" ? gcpStore : localStore;
}

export const secretName = (integrationKey: string) => `integration-${integrationKey}`;

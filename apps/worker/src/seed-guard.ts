/**
 * The seed wipes users, connections and every content table, so it refuses to run unless
 * asked for explicitly: SEED_CONFIRM=yes always, plus SEED_ALLOW_PRODUCTION=yes when
 * NODE_ENV=production (only the VM's first install does that, with SEED=1).
 */
export function seedRefusal(env: NodeJS.ProcessEnv): string | null {
  if (env.SEED_CONFIRM !== "yes") {
    return "The seed deletes all users, connections and content. Set SEED_CONFIRM=yes to run it against this database.";
  }
  if (env.NODE_ENV === "production" && env.SEED_ALLOW_PRODUCTION !== "yes") {
    return "Refusing to seed with NODE_ENV=production. Set SEED_ALLOW_PRODUCTION=yes only for a brand-new install.";
  }
  if (!env.DEV_USER_EMAIL?.trim()) return "Set DEV_USER_EMAIL: the seed makes that person the admin.";
  return null;
}

/** host:port/database from a Postgres URL, for the "about to seed" line. Never prints the password. */
export function targetHost(url: string | undefined): string {
  try {
    const u = new URL(url ?? "postgres://bodh:bodh@localhost:5433/bodh");
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

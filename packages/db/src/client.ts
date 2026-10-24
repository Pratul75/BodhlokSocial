import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgres://bodh:bodh@localhost:5433/bodh";
// On Cloud Run, Cloud SQL is reached through a Unix socket in /cloudsql/<instance>.
const socketDir = process.env.DB_SOCKET_DIR;

// Reuse one pool across Next.js hot reloads in development.
const globalForDb = globalThis as unknown as { __bodhSql?: ReturnType<typeof postgres> };
const sql = globalForDb.__bodhSql ?? postgres(url, {
  max: Number(process.env.DB_POOL_SIZE ?? 10),
  onnotice: () => {},
  ...(socketDir ? { path: `${socketDir}/.s.PGSQL.5432` } : {}),
});
if (process.env.NODE_ENV !== "production") globalForDb.__bodhSql = sql;

export const db = drizzle(sql, { schema });
export type DB = typeof db;
export { sql };

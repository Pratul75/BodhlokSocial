import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, users } from "@bodh/db";
import { canAccess, isRole, type ModuleKey, type Role } from "@bodh/shared";
import { authEnabled, SESSION_COOKIE, verifySessionToken } from "./session";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** True when Google sign-in is not configured and the dev user is used. */
  devMode: boolean;
}

export const DEV_ROLE_COOKIE = "bodh_dev_role";

/**
 * With Google sign-in configured, the user comes from the session cookie and their
 * role from the database. Without it (local development only), every request runs
 * as DEV_USER_EMAIL and a cookie can preview other roles.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const jar = await cookies();

  if (authEnabled()) {
    const claims = await verifySessionToken(jar.get(SESSION_COOKIE)?.value);
    if (!claims) redirect("/signin");
    const [row] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, claims.sub), eq(users.active, true)))
      .limit(1);
    if (!row) redirect("/signin?error=no_access");
    const role: Role = isRole(row.role) ? row.role : "social_manager";
    return { id: row.id, email: row.email, name: row.name, role, devMode: false };
  }

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "true") {
    throw new Error("Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }

  const email = process.env.DEV_USER_EMAIL ?? "kshitij@rechargestudio.com";
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`No user ${email}. Run "pnpm db:seed" or add the user in Admin.`);
  const override = jar.get(DEV_ROLE_COOKIE)?.value;
  const role: Role = isRole(override) ? override : isRole(row.role) ? row.role : "social_manager";
  return { id: row.id, email: row.email, name: row.name, role, devMode: true };
}

/** Use at the top of each page. Sends people without access back to their home page. */
export async function requireModule(key: ModuleKey): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!canAccess(user.role, key)) {
    redirect(user.role === "sales" ? "/leads" : "/");
  }
  return user;
}

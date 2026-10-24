import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, users } from "@bodh/db";
import { canAccess, isRole, type ModuleKey, type Role } from "@bodh/shared";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** True while Google sign-in is not configured and the dev user is used. */
  devMode: boolean;
}

export const DEV_ROLE_COOKIE = "bodh_dev_role";

/**
 * Until Google sign-in is configured (Phase 1), every request runs as DEV_USER_EMAIL.
 * In dev mode a cookie can override the role so each role's view can be checked.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  const email = process.env.DEV_USER_EMAIL ?? "kshitij@rechargestudio.com";
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) {
    throw new Error(`No user ${email}. Run "pnpm db:seed" or add the user in Admin.`);
  }
  const jar = await cookies();
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

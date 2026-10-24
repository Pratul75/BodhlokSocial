"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isRole } from "@bodh/shared";
import { DEV_ROLE_COOKIE } from "@/lib/auth";

export async function setDevRole(formData: FormData) {
  const role = formData.get("role");
  const jar = await cookies();
  if (isRole(role)) jar.set(DEV_ROLE_COOKIE, role, { path: "/", sameSite: "lax", httpOnly: true });
  revalidatePath("/", "layout");
}

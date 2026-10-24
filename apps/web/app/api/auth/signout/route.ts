import { NextResponse } from "next/server";
import { appUrl } from "@/lib/google";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/signin?signed_out=1", appUrl(req)), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

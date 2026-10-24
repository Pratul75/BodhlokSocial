import "server-only";
import { readJsonSecret } from "@bodh/integrations/secrets";

/**
 * Postiz OAuth (https://docs.postiz.com/oauth): an app in Settings > Developers > Apps gives a
 * client ID (pca_) and secret (pcs_). Its tokens (pos_) don't expire and work with the public
 * API exactly like an API key.
 */
export interface PostizApp {
  client_id: string;
  client_secret: string;
  app_url?: string;
}

export async function postizApp(): Promise<PostizApp | null> {
  const a = await readJsonSecret<PostizApp>("postiz_app");
  return a?.client_id && a.client_secret ? a : null;
}

/** Postiz Cloud's sign-in page is platform.postiz.com and its API api.postiz.com; self-hosted serves both from one address. */
export function postizUrls(app: PostizApp) {
  const cloud = { frontend: "https://platform.postiz.com", backend: "https://api.postiz.com" };
  let custom: URL;
  try {
    custom = new URL(app.app_url?.trim() ?? "");
  } catch {
    return cloud;
  }
  // Our own address (the redirect URL pasted in the wrong box) or Postiz Cloud: use the cloud.
  const ours = process.env.APP_URL ? new URL(process.env.APP_URL).host : "";
  if (custom.host === ours || custom.pathname.includes("/api/connect") || /(^|\.)postiz\.com$/.test(custom.host)) return cloud;
  return { frontend: custom.origin, backend: `${custom.origin}/api` };
}

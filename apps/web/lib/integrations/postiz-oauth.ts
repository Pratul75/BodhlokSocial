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
  const custom = app.app_url?.trim().replace(/\/$/, "");
  if (!custom || /^https:\/\/(platform|app)\.postiz\.com$/.test(custom)) return { frontend: "https://platform.postiz.com", backend: "https://api.postiz.com" };
  return { frontend: custom, backend: `${custom}/api` };
}

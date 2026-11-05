/**
 * Headers for calling the worker. Always the shared X-Worker-Token; on Cloud Run, where the
 * worker only accepts callers with run.invoker, also an identity token for the web service's
 * own service account (WORKER_USE_ID_TOKEN=true, set by infra/run.tf).
 */
export async function workerHeaders(workerUrl: string, token: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "X-Worker-Token": token };
  if (process.env.WORKER_USE_ID_TOKEN !== "true") return headers;
  const { GoogleAuth } = await import("google-auth-library");
  const audience = new URL(workerUrl).origin;
  const client = await new GoogleAuth().getIdTokenClient(audience);
  const h = (await client.getRequestHeaders(audience)) as unknown;
  const auth = h instanceof Headers ? h.get("authorization") : (h as Record<string, string>).Authorization ?? (h as Record<string, string>).authorization;
  if (auth) headers.Authorization = auth;
  return headers;
}

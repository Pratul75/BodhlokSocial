/**
 * Vertex AI generation.
 * - Images: Gemini image models through generateContent on the global endpoint.
 *   (Imagen 3 and 4 were discontinued in 2026.)
 * - Video: Veo through predictLongRunning, polled with fetchPredictOperation.
 * Credentials: the vertex connection's service account JSON, or the runtime identity.
 */
export const IMAGE_MODEL = process.env.VERTEX_IMAGE_MODEL ?? "gemini-2.5-flash-image";
export const VIDEO_MODEL = process.env.VERTEX_VIDEO_MODEL ?? "veo-3.1-fast-generate-001";
export const VIDEO_LOCATION = process.env.VERTEX_VIDEO_LOCATION ?? "us-central1";

export interface ServiceAccountKey {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface VertexAuth {
  projectId: string;
  accessToken: string;
}

export async function vertexAuth(key: ServiceAccountKey | null): Promise<VertexAuth> {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    ...(key ? { credentials: { client_email: key.client_email, private_key: key.private_key } } : {}),
  });
  const projectId = process.env.VERTEX_PROJECT_ID ?? key?.project_id ?? process.env.GCP_PROJECT_ID ?? (await auth.getProjectId());
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Couldn't get a Google access token for Vertex AI.");
  return { projectId, accessToken: token };
}

export class VertexError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function vertexFetch(url: string, auth: VertexAuth, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
    } catch {}
    throw new VertexError(`Vertex AI ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
  }
  return res.json();
}

export const IMAGE_ASPECTS = ["1:1", "4:5", "9:16", "16:9"] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
}

export function imageRequest(prompt: string, aspectRatio: ImageAspect) {
  return {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio } },
  };
}

/** Pulls the first image out of a generateContent response, or explains why there isn't one. */
export function imageFromResponse(json: unknown): GeneratedImage {
  const r = json as {
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; inlineData?: { mimeType: string; data: string } }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  if (r.promptFeedback?.blockReason) throw new VertexError(`The prompt was blocked (${r.promptFeedback.blockReason}). Reword it.`, 400);
  const c = r.candidates?.[0];
  const part = c?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData) {
    const text = c?.content?.parts?.find((p) => p.text)?.text;
    const reason = c?.finishReason && c.finishReason !== "STOP" ? ` (${c.finishReason})` : "";
    throw new VertexError(`No image came back${reason}.${text ? ` The model said: ${text.slice(0, 200)}` : ""}`, 422);
  }
  return { bytes: Buffer.from(part.inlineData.data, "base64"), mimeType: part.inlineData.mimeType };
}

export async function generateImage(auth: VertexAuth, prompt: string, aspectRatio: ImageAspect): Promise<GeneratedImage> {
  const url = `https://aiplatform.googleapis.com/v1/projects/${auth.projectId}/locations/global/publishers/google/models/${IMAGE_MODEL}:generateContent`;
  return imageFromResponse(await vertexFetch(url, auth, imageRequest(prompt, aspectRatio)));
}

export interface VideoOptions {
  aspectRatio: "16:9" | "9:16";
  durationSeconds: 4 | 6 | 8;
  generateAudio: boolean;
  /** gs:// folder Vertex writes the video to; without it the video comes back inline. */
  storageUri?: string | null;
}

export function videoRequest(prompt: string, o: VideoOptions) {
  const parameters: Record<string, unknown> = {
    aspectRatio: o.aspectRatio,
    durationSeconds: o.durationSeconds,
    generateAudio: o.generateAudio,
    resolution: "720p",
    sampleCount: 1,
    personGeneration: "allow_adult",
  };
  if (o.storageUri) parameters.storageUri = o.storageUri;
  return { instances: [{ prompt }], parameters };
}

const videoBase = (auth: VertexAuth) =>
  `https://${VIDEO_LOCATION}-aiplatform.googleapis.com/v1/projects/${auth.projectId}/locations/${VIDEO_LOCATION}/publishers/google/models/${VIDEO_MODEL}`;

export async function startVideo(auth: VertexAuth, prompt: string, o: VideoOptions): Promise<string> {
  const json = (await vertexFetch(`${videoBase(auth)}:predictLongRunning`, auth, videoRequest(prompt, o))) as { name?: string };
  if (!json.name) throw new VertexError("Vertex AI didn't return an operation for the video.", 502);
  return json.name;
}

export type VideoPoll =
  | { done: false }
  | { done: true; ok: true; video: { bytes?: Buffer; gcsUri?: string; mimeType: string } }
  | { done: true; ok: false; error: string };

export function videoFromOperation(json: unknown): VideoPoll {
  const op = json as {
    done?: boolean;
    error?: { message?: string };
    response?: { raiMediaFilteredCount?: number; raiMediaFilteredReasons?: string[]; videos?: { bytesBase64Encoded?: string; gcsUri?: string; mimeType?: string }[] };
  };
  if (!op.done) return { done: false };
  if (op.error) return { done: true, ok: false, error: op.error.message ?? "Video generation failed." };
  const v = op.response?.videos?.[0];
  if (!v) {
    const why = op.response?.raiMediaFilteredReasons?.join(" ") ?? "";
    return { done: true, ok: false, error: `The video was filtered by safety checks.${why ? ` ${why}` : ""}` };
  }
  return {
    done: true,
    ok: true,
    video: { bytes: v.bytesBase64Encoded ? Buffer.from(v.bytesBase64Encoded, "base64") : undefined, gcsUri: v.gcsUri, mimeType: v.mimeType ?? "video/mp4" },
  };
}

export async function pollVideo(auth: VertexAuth, operationName: string): Promise<VideoPoll> {
  return videoFromOperation(await vertexFetch(`${videoBase(auth)}:fetchPredictOperation`, auth, { operationName }));
}

/* ---------- prompts with the brand kit ---------- */

export interface BrandForPrompt {
  imageStyle: string;
  palette: { name: string; hex: string }[];
}

export type CreativeKind = "image" | "carousel" | "thumbnail" | "video";

export function brandPrompt(
  prompt: string,
  brand: BrandForPrompt,
  kind: CreativeKind,
  extra: { slide?: number; slides?: number } = {},
): string {
  const lines = [prompt.trim()];
  if (kind === "carousel" && extra.slide && extra.slides) {
    lines.push(`This is slide ${extra.slide} of ${extra.slides} in one Instagram carousel; keep the same style, palette and framing across slides.`);
  }
  if (kind === "thumbnail") {
    lines.push("Compose it as a YouTube thumbnail: one bold, high-contrast subject on the right, the left third kept simple for a title.");
  }
  if (brand.imageStyle.trim()) lines.push(`Visual style: ${brand.imageStyle.trim()}`);
  if (brand.palette.length) lines.push(`Colour palette: ${brand.palette.map((c) => `${c.name} ${c.hex}`).join(", ")}.`);
  if (kind !== "video") lines.push("Do not render any text, letters, logos or watermarks in the image.");
  return lines.join("\n");
}

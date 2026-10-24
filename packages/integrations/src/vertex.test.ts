import { afterEach, describe, expect, it, vi } from "vitest";
import { brandPrompt, generateImage, imageFromResponse, imageRequest, pollVideo, startVideo, videoFromOperation, videoRequest } from "./vertex";
import { imageSize } from "./storage";

afterEach(() => vi.unstubAllGlobals());
const auth = { projectId: "bodh-prod", accessToken: "tok" };
const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("images", () => {
  it("asks for an image at the chosen aspect ratio", () => {
    expect(imageRequest("a kundli chart", "4:5")).toEqual({
      contents: [{ role: "user", parts: [{ text: "a kundli chart" }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "4:5" } },
    });
  });

  it("reads the image part and ignores text parts", () => {
    const img = imageFromResponse({ candidates: [{ content: { parts: [{ text: "Here it is" }, { inlineData: { mimeType: "image/png", data: png1x1 } }] } }] });
    expect(img.mimeType).toBe("image/png");
    expect(imageSize(img.bytes)).toEqual({ width: 1, height: 1 });
  });

  it("explains blocked prompts and missing images", () => {
    expect(() => imageFromResponse({ promptFeedback: { blockReason: "SAFETY" } })).toThrow("blocked (SAFETY)");
    expect(() => imageFromResponse({ candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [{ text: "I can't" }] } }] })).toThrow(/No image came back \(IMAGE_SAFETY\)\. The model said: I can't/);
  });

  it("calls the global generateContent endpoint with a bearer token", async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png1x1 } }] } }] }));
    vi.stubGlobal("fetch", f);
    await generateImage(auth, "p", "1:1");
    const [url, init] = f.mock.calls[0]!;
    expect(url).toMatch(/^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/bodh-prod\/locations\/global\/publishers\/google\/models\/[\w.-]+:generateContent$/);
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
});

describe("video", () => {
  it("builds a Veo request and writes to the bucket when given a folder", () => {
    expect(videoRequest("p", { aspectRatio: "9:16", durationSeconds: 8, generateAudio: true, storageUri: "gs://b/generated/" }).parameters).toMatchObject({
      aspectRatio: "9:16",
      durationSeconds: 8,
      generateAudio: true,
      sampleCount: 1,
      storageUri: "gs://b/generated/",
    });
    expect(videoRequest("p", { aspectRatio: "16:9", durationSeconds: 4, generateAudio: false }).parameters).not.toHaveProperty("storageUri");
  });

  it("starts and polls a long-running operation", async () => {
    const f = vi.fn(async (u: string) =>
      u.endsWith(":predictLongRunning") ? Response.json({ name: "projects/p/locations/us-central1/publishers/google/models/veo/operations/123" }) : Response.json({ done: false }),
    );
    vi.stubGlobal("fetch", f);
    const op = await startVideo(auth, "p", { aspectRatio: "9:16", durationSeconds: 8, generateAudio: true });
    expect(op).toMatch(/operations\/123$/);
    expect(await pollVideo(auth, op)).toEqual({ done: false });
    expect(String(f.mock.calls[1]![0])).toMatch(/:fetchPredictOperation$/);
    expect(JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ operationName: op });
  });

  it("reads finished, failed and filtered operations", () => {
    expect(videoFromOperation({ done: true, response: { videos: [{ gcsUri: "gs://b/generated/x.mp4", mimeType: "video/mp4" }] } })).toEqual({
      done: true,
      ok: true,
      video: { bytes: undefined, gcsUri: "gs://b/generated/x.mp4", mimeType: "video/mp4" },
    });
    expect(videoFromOperation({ done: true, error: { message: "quota" } })).toEqual({ done: true, ok: false, error: "quota" });
    expect(videoFromOperation({ done: true, response: { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ["Contains a person."] } })).toMatchObject({ ok: false, error: expect.stringContaining("Contains a person.") });
  });
});

describe("brandPrompt", () => {
  const brand = { imageStyle: "Warm indigo night sky, brass instruments", palette: [{ name: "Turmeric", hex: "#E0A21B" }] };
  it("adds style, palette and the no-text rule", () => {
    const p = brandPrompt("A Kundli chart on a desk", brand, "image");
    expect(p).toContain("Visual style: Warm indigo night sky");
    expect(p).toContain("Turmeric #E0A21B");
    expect(p).toContain("Do not render any text");
  });
  it("keeps carousel slides consistent and leaves room for thumbnail titles", () => {
    expect(brandPrompt("x", brand, "carousel", { slide: 2, slides: 5 })).toContain("slide 2 of 5");
    expect(brandPrompt("x", brand, "thumbnail")).toContain("left third kept simple");
    expect(brandPrompt("x", brand, "video")).not.toContain("Do not render any text");
  });
});

describe("imageSize", () => {
  it("reads JPEG dimensions", () => {
    // SOI, then an SOF0 segment: length 17, precision 8, height 720, width 1280
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(imageSize(jpeg)).toEqual({ width: 1280, height: 720 });
  });
});

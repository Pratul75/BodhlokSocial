import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * Applies the brand kit to a generated image: a title in Bricolage on thumbnails, and the
 * logo stamped bottom right. Rendered with Next's built-in image renderer, so no system
 * fonts or native image libraries are needed.
 */
let fontCache: { display: Buffer; body: Buffer } | null = null;
async function fonts() {
  if (!fontCache) {
    const dir = join(/* turbopackIgnore: true */ process.cwd(), "assets/fonts");
    fontCache = {
      display: await readFile(join(dir, "bricolage-grotesque-latin-800-normal.woff")),
      body: await readFile(join(dir, "ibm-plex-sans-latin-600-normal.woff")),
    };
  }
  return fontCache;
}

const dataUrl = (bytes: Buffer, mime: string) => `data:${mime};base64,${bytes.toString("base64")}`;

export interface ComposeInput {
  image: { bytes: Buffer; mimeType: string; width: number; height: number };
  /** Output size; the image covers it. Defaults to the image's own size. */
  size?: { width: number; height: number };
  title?: string | null;
  logo?: { bytes: Buffer; mimeType: string } | null;
  accent?: string;
}

export async function compose(input: ComposeInput): Promise<Buffer> {
  const { width, height } = input.size ?? { width: input.image.width, height: input.image.height };
  const f = await fonts();
  const title = input.title?.trim();
  const titleSize = Math.round(height * (title && title.length > 40 ? 0.085 : 0.11));

  const res = new ImageResponse(
    (
      <div style={{ width, height, display: "flex", position: "relative", background: "#191c3a" }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={dataUrl(input.image.bytes, input.image.mimeType)} width={width} height={height} style={{ position: "absolute", top: 0, left: 0, width, height, objectFit: "cover" }} />
        {title && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              bottom: 0,
              width: Math.round(width * 0.58),
              display: "flex",
              alignItems: "center",
              padding: `0 ${Math.round(width * 0.045)}px`,
              backgroundImage: "linear-gradient(90deg, rgba(25,28,58,0.92) 0%, rgba(25,28,58,0.75) 70%, rgba(25,28,58,0) 100%)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ width: Math.round(width * 0.06), height: Math.round(height * 0.018), background: input.accent ?? "#e0a21b", marginBottom: Math.round(height * 0.035) }} />
              <div style={{ fontFamily: "Bricolage", fontSize: titleSize, lineHeight: 1.02, color: "#ffffff", letterSpacing: -1 }}>{title}</div>
            </div>
          </div>
        )}
        {input.logo && (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img
            src={dataUrl(input.logo.bytes, input.logo.mimeType)}
            style={{ position: "absolute", right: Math.round(width * 0.035), bottom: Math.round(height * 0.04), height: Math.round(height * 0.09), objectFit: "contain" }}
          />
        )}
      </div>
    ),
    {
      width,
      height,
      fonts: [
        { name: "Bricolage", data: f.display, weight: 800, style: "normal" },
        { name: "Plex", data: f.body, weight: 600, style: "normal" },
      ],
    },
  );
  return Buffer.from(await res.arrayBuffer());
}

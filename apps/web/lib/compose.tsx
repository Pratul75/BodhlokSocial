import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * Applies the brand kit to a generated image: the post's heading in Bricolage, a subheading and
 * a call to action under it, and the logo stamped bottom right. Rendered with Next's built-in
 * image renderer, so no system fonts or native image libraries are needed.
 *
 * The three lines are the post's own — the same heading, subheading and call to action the
 * calendar item carries — so what is printed on the creative and what a person reads in the app
 * can never drift apart.
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
  /** The line under the heading, in the body face. Skipped when there is no heading to sit under. */
  subhead?: string | null;
  /** The one thing to do next, set off by the accent colour. */
  cta?: string | null;
  logo?: { bytes: Buffer; mimeType: string } | null;
  accent?: string;
}

export async function compose(input: ComposeInput): Promise<Buffer> {
  const { width, height } = input.size ?? { width: input.image.width, height: input.image.height };
  const f = await fonts();
  const title = input.title?.trim();
  // A subheading or a call to action with no heading has nothing to sit under, and reads as a
  // stray line across somebody's picture.
  const subhead = title ? input.subhead?.trim() : "";
  const cta = title ? input.cta?.trim() : "";
  const titleSize = Math.round(height * (title && title.length > 40 ? 0.085 : 0.11));
  const subheadSize = Math.round(titleSize * 0.42);
  const ctaSize = Math.round(titleSize * 0.34);
  const accent = input.accent ?? "#e0a21b";
  // The block grows downwards as lines are added, so the gradient panel has to be wider when
  // there is more than a heading in it.
  const panel = Math.round(width * (subhead || cta ? 0.64 : 0.58));

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
              width: panel,
              display: "flex",
              alignItems: "center",
              padding: `0 ${Math.round(width * 0.045)}px`,
              backgroundImage: "linear-gradient(90deg, rgba(25,28,58,0.92) 0%, rgba(25,28,58,0.75) 70%, rgba(25,28,58,0) 100%)",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ width: Math.round(width * 0.06), height: Math.round(height * 0.018), background: accent, marginBottom: Math.round(height * 0.035) }} />
              <div style={{ fontFamily: "Bricolage", fontSize: titleSize, lineHeight: 1.02, color: "#ffffff", letterSpacing: -1 }}>{title}</div>
              {subhead && (
                <div
                  style={{
                    fontFamily: "Plex",
                    fontSize: subheadSize,
                    lineHeight: 1.25,
                    color: "rgba(255,255,255,0.82)",
                    marginTop: Math.round(height * 0.022),
                  }}
                >
                  {subhead}
                </div>
              )}
              {cta && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    fontFamily: "Plex",
                    fontSize: ctaSize,
                    lineHeight: 1.1,
                    color: "#191c3a",
                    background: accent,
                    padding: `${Math.round(ctaSize * 0.52)}px ${Math.round(ctaSize * 0.9)}px`,
                    borderRadius: Math.round(ctaSize * 0.5),
                    marginTop: Math.round(height * 0.032),
                  }}
                >
                  {cta}
                </div>
              )}
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
